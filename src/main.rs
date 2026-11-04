use anyhow::{Context, Result, ensure};
use clap::Parser;
use command_center::{AppState, config::Config, router};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

#[derive(Parser)]
#[command(version, about = "Command Center — focused tmux control")]
struct Args {
    #[arg(long)]
    config: Option<PathBuf>,
    #[arg(long, default_value = "127.0.0.1:8080")]
    listen: SocketAddr,
    /// Additional direct listener on this machine's active Tailscale IPv4 address.
    #[arg(long)]
    tailnet_listen: Option<SocketAddr>,
    /// Additional direct listener on an explicitly trusted private LAN IPv4 address.
    #[arg(long)]
    lan_listen: Option<SocketAddr>,
    /// Exact HTTPS origin accepted behind a trusted reverse proxy.
    #[arg(long, value_parser = parse_public_origin)]
    public_origin: Option<String>,
    #[arg(long, default_value = "web/dist")]
    web_dir: PathBuf,
}
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "command_center=info".into()),
        )
        .init();
    let args = Args::parse();
    ensure!(
        args.listen.ip() == IpAddr::V4(Ipv4Addr::LOCALHOST),
        "the primary listener must use 127.0.0.1; use --tailnet-listen or --lan-listen for additional direct access"
    );
    let tailnet_listener = if let Some(address) = args.tailnet_listen {
        let output = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::process::Command::new("tailscale")
                .args(["ip", "-4"])
                .stdin(std::process::Stdio::null())
                .kill_on_drop(true)
                .output(),
        )
        .await
        .context("Tailscale address check timed out")?
        .context("checking local Tailscale address")?;
        ensure!(
            address.is_ipv4()
                && address.port() != 0
                && output.status.success()
                && String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .any(|ip| ip == address.ip().to_string()),
            "--tailnet-listen must use this machine's active Tailscale IPv4 address and a nonzero port"
        );
        Some(
            tokio::net::TcpListener::bind(address)
                .await
                .context("binding Tailscale listener")?,
        )
    } else {
        None
    };
    let lan_listener = if let Some(address) = args.lan_listen {
        ensure!(
            valid_lan_address(address),
            "--lan-listen requires a private LAN IPv4 address and a nonzero port"
        );
        Some(
            tokio::net::TcpListener::bind(address)
                .await
                .context("binding LAN listener (use an address assigned to this machine)")?,
        )
    } else {
        None
    };
    ensure!(
        args.web_dir.join("index.html").is_file(),
        "frontend missing; run npm --prefix web ci && npm --prefix web run build first"
    );
    let explicit = args.config.is_some();
    let config_path =
        std::env::current_dir()?.join(args.config.unwrap_or_else(|| "config.toml".into()));
    let config = if explicit || config_path.exists() {
        Config::load(Some(&config_path))?
    } else {
        Config::load(None)?
    };
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .context("binding server")?;
    let address = listener.local_addr()?;
    let mut state = AppState::with_config(config, address.port(), Some(config_path))?;
    Arc::get_mut(&mut state)
        .expect("new backend state is unshared")
        .tailnet_address = args.tailnet_listen;
    Arc::get_mut(&mut state)
        .expect("new backend state is unshared")
        .lan_address = args.lan_listen;
    Arc::get_mut(&mut state)
        .expect("new backend state is unshared")
        .public_origin = args.public_origin;
    tracing::info!("Command Center at http://{address}");
    let shutdown = state.shutdown.clone();
    let app = router(state.clone(), args.web_dir);
    let mut additional_servers = Vec::new();
    for (kind, listener) in [("tailnet", tailnet_listener), ("LAN", lan_listener)] {
        let Some(listener) = listener else {
            continue;
        };
        tracing::info!(
            "Command Center on {kind} at http://{}",
            listener.local_addr()?
        );
        let app = app.clone();
        let mut stop = state.shutdown.subscribe();
        additional_servers.push(tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    if !*stop.borrow() {
                        let _ = stop.changed().await;
                    }
                })
                .await
        }));
    }
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            wait_for_shutdown().await;
            let _ = shutdown.send(true);
        })
        .await?;
    for server in additional_servers {
        server.await.context("additional listener task")??;
    }
    Ok(())
}

async fn wait_for_shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

fn parse_public_origin(value: &str) -> Result<String, String> {
    let uri: axum::http::Uri = value.parse().map_err(|_| "invalid HTTPS origin")?;
    let authority = uri.authority().ok_or("HTTPS origin needs a hostname")?;
    if uri.scheme_str() != Some("https")
        || authority.as_str().contains('@')
        || uri
            .path_and_query()
            .is_some_and(|path| path.as_str() != "/")
        || value.contains(['?', '#'])
        || authority.host().is_empty()
    {
        return Err("expected an HTTPS origin without credentials, path, query or fragment".into());
    }
    Ok(format!("https://{authority}"))
}

fn valid_lan_address(address: SocketAddr) -> bool {
    matches!(address.ip(),IpAddr::V4(ip) if ip.is_private()) && address.port() != 0
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_origin_is_exact_https_authority() {
        assert_eq!(
            parse_public_origin("https://cc.example.ts.net/").unwrap(),
            "https://cc.example.ts.net"
        );
        assert_eq!(
            parse_public_origin("https://example.com:8443").unwrap(),
            "https://example.com:8443"
        );
        for value in [
            "http://example.com",
            "https://user@example.com",
            "https://example.com/path",
            "https://example.com?q=1",
            "https://example.com#fragment",
        ] {
            assert!(parse_public_origin(value).is_err(), "{value}");
        }
    }
    #[test]
    fn lan_requires_explicit_private_ipv4_and_port() {
        for addr in ["10.0.0.10:8080", "10.0.0.2:8080", "172.16.0.2:9000"] {
            assert!(valid_lan_address(addr.parse().unwrap()));
        }
        for addr in [
            "0.0.0.0:8080",
            "127.0.0.1:8080",
            "100.64.0.10:8080",
            "8.8.8.8:8080",
            "10.0.0.10:0",
            "[::]:8080",
        ] {
            assert!(!valid_lan_address(addr.parse().unwrap()));
        }
    }
}
