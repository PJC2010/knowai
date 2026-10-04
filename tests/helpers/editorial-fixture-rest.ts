// Local test adapter only. Never import from application code.
import type { PGlite } from "@electric-sql/pglite";
const identifier = (value: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error("Invalid fixture SQL identifier");
  return `"${value}"`;
};
export async function fixtureRest(
  db: PGlite, role: string, path: string, method: string,
  headers: Record<string, string | undefined>, body: Record<string, unknown> | null,
  actor = "11111111-1111-4111-8111-111111111111",
): Promise<{body: unknown; total?: number}> {
  const url = new URL(path, "http://127.0.0.1");
  const segments = url.pathname.split("/").filter(Boolean);
  return db.transaction(async tx => {
    await tx.exec(`set local role ${identifier(role)}`);
    if (await tx.query("select 1 from pg_namespace where nspname='auth'").then(r=>r.rows.length))
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[role==='authenticated'?actor:'']);
    if (segments[0] === 'rpc') {
      const name=segments[1]; identifier(name);
      const result=await tx.query<{names:string[];types:string[];returns_set:boolean}>(`select p.proargnames as names, array(select format_type(t,null) from unnest(p.proargtypes::oid[]) t) as types, p.proretset as returns_set from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname=$1`,[name]);
      const supplied=Object.keys(body||{});
      const fn=result.rows.find(r=>supplied.every(k=>(r.names||[]).includes(k)));
      if (!fn) throw new Error(`Fixture RPC not found: ${name}`);
      const values: unknown[]=[];
      const args=supplied.map((key,i)=>{
        identifier(key);
        const type=fn.types[fn.names.indexOf(key)];
        if(!/^[a-z_][a-z0-9_ ]*(\[\])?$/.test(type))throw new Error('Unsupported fixture RPC type');
        const value=body![key];
        values.push(type==='jsonb'||type==='json'?JSON.stringify(value):value);
        return `${identifier(key)} => $${i+1}::${type}`;
      });
      const rows=await tx.query<{value: unknown}>(`select ${identifier(name)}(${args.join(',')}) as value`,values);
      return {body:fn.returns_set?rows.rows.map(r=>r.value):rows.rows[0]?.value??null};
    }
    const table=segments[0]; identifier(table);
    if(!['GET','HEAD'].includes(method))throw new Error('Fixture only supports reads and RPC writes');
    const columns=(await tx.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table])).rows.map(r=>r.column_name);
    const select=url.searchParams.get('select')||'*';
    const hasSource=select.includes('brief_sources(')||select.includes('brief_sources!');
    const values:unknown[]=[];
    const filter=(key:string,raw:string):string=>{
      const col=key.startsWith('brief_sources.')?'s.'+identifier(key.slice(14)):'r.'+identifier(key);
      const dot=raw.indexOf('.'); const op=raw.slice(0,dot), value=raw.slice(dot+1);
      if(op==='in') { const items=value.replace(/^\(|\)$/g,'').split(','); return `${col} in (${items.map(v=>{values.push(v); return '$'+values.length;}).join(',')})`; }
      if(op==='is'&&['null','true','false'].includes(value))return `${col} is ${value}`;
      const ops:Record<string,string>={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<=',like:'like',ilike:'ilike'};
      if(!ops[op]) throw new Error(`Unsupported fixture filter: ${op}`);
      values.push(value);return `${col} ${ops[op]} $${values.length}`;
    };
    const conditions:string[]=[];
    for(const [key,value] of url.searchParams){
      if(['select','order','offset','limit'].includes(key))continue;
      if(key==='or'){conditions.push('('+value.replace(/^\(|\)$/g,'').split(',').map(part=>{const pos=part.indexOf('.');return filter(part.slice(0,pos),part.slice(pos+1));}).join(' or ')+')');}
      else conditions.push(filter(key,value));
    }
    const from=`from ${identifier(table)} r${hasSource?' left join brief_sources s on s.id=r.story_id':''}${conditions.length?' where '+conditions.join(' and '):''}`;
    const total=Number((await tx.query<{count:number}>(`select count(*) as count ${from}`,values)).rows[0].count);
    if(method==='HEAD')return {body:null,total};
    const projection=hasSource?'r.*,to_jsonb(s) as brief_sources':select==='*'?'r.*':select.split(',').map(c=>{if(!columns.includes(c))throw new Error('Unknown fixture column '+c);return 'r.'+identifier(c);}).join(',');
    const order=(url.searchParams.get('order')||'').split(',').filter(Boolean).map(spec=>{const [col,direction]=spec.split('.');return `r.${identifier(col)} ${direction==='desc'?'desc':'asc'}`;});
    const offset=Math.max(0,Number(url.searchParams.get('offset'))||0);
    const limit=Math.max(1,Math.min(10000,Number(url.searchParams.get('limit'))||1000));
    const rows=(await tx.query(`select ${projection} ${from}${order.length?' order by '+order.join(','):''} limit ${limit} offset ${offset}`,values)).rows;
    return {body:headers.accept?.includes('vnd.pgrst.object')?rows[0]??null:rows,total};
  });
}
