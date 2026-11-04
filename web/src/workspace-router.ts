export type Workspace='terminal'|'files'|'queue'|'slack'|'email'|'board'|'jira';
const workspaces:Workspace[]=['terminal','files','queue','slack','email','board','jira'];
export function readWorkspace():Workspace|undefined {
 const match=/^#\/([a-z]+)\/?$/.exec(location.hash);
 return match&&workspaces.includes(match[1] as Workspace)?match[1] as Workspace:undefined;
}
export function writeWorkspace(workspace:Workspace,replace=false){
 const hash=`#/${workspace}`;
 if(location.hash!==hash){const url=location.pathname+location.search+hash;history[replace?'replaceState':'pushState'](null,'',url);}
}
