export async function enableFeatures(base:string){
 const current=await(await fetch(base+'/api/v1/settings/features')).json();
 const response=await fetch(base+'/api/v1/settings/features',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,features:{slack:true,email:true,jira:true}})});
 if(!response.ok)throw Error('Could not enable fixture features: '+response.status);
}
