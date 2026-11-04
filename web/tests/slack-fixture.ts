import {cpSync,mkdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export function makeSlackSource(project:string,extra:Record<string,unknown>={}){
 cpSync(fileURLToPath(new URL('../../tests/fixtures/slack-source',import.meta.url)),project,{recursive:true});mkdirSync(join(project,'.venv/bin'),{recursive:true});
 const python=spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).stdout.trim();symlinkSync(python,join(project,'.venv/bin/python'));
 const message=(ts:string,text:string,rest={})=>({ts,text,user:'U000001',...rest});
 const data={dms:[{id:'D000001',user:'U000001',is_im:true},{id:'D000002',user:'U000003',is_im:true}],dms2:[{id:'D000003',user:'U000002',is_im:true}],dm_cursor:'dm-more',dm_latest:{D000001:'1700000400.000001',D000002:'1700000300.000001'},user_names:{U000003:'charlie'},dm_messages:{D000001:[message('1700000400.000001','Direct message fixture')],D000002:[message('1700000300.000001','Charlie conversation',{user:'U000003'})]},dm_older:{D000001:[message('1700000200.000001','Older direct message')]},dm_history_cursor:'dm-older',latest:{C000001:'1700000100.000002',C000002:'1700000200.000003'},channels:[{id:'C000001',name:'engineering',topic:{value:'Engineering work'}},{id:'C000002',name:'product',is_private:true}],channels2:[{id:'C000003',name:'support'}],channel_cursor:'more',
 messages:[message('1700000100.000002','Latest *update* with `code` and <@U000002>'),message('1700000000.000001','Parent message <img src=x onerror=window.pwned=1> <javascript:alert(1)|bad>',{reply_count:2,token:'FAKE_AUTH_SECRET',files:[{url_private:'https://files.slack.com/FAKE_COOKIE_SECRET'}]})],history_cursor:'older',older:[message('1699999900.000001','An older message')],
 replies:[message('1700000000.000001','Thread parent'),message('1700000001.000001','First reply',{thread_ts:'1700000000.000001',user:'U000002'})],thread_cursor:'next',replies2:[message('1700000002.000001','Second reply',{thread_ts:'1700000000.000001'})],
 matches:[message('1700000200.000003','Search result text',{channel:{id:'C000002',name:'product'},permalink:'https://fixture.slack.com/archives/C000002/p1700000200000003?thread_ts=1700000000.000001'})],...extra};
 writeFileSync(join(project,'fixture.json'),JSON.stringify(data));return data;
}
