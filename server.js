const express=require("express");
const session=require("express-session");
const Database=require("better-sqlite3");
const path=require("path");
const crypto=require("crypto");
const fs=require("fs");

const app=express(),PORT=process.env.PORT||3000;
const dir=path.join(__dirname,"data");fs.mkdirSync(dir,{recursive:true});
const db=new Database(path.join(dir,"nexux.db"));db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,is_admin INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS titles(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN('movie','series')),year TEXT,genre TEXT,rating TEXT,poster TEXT NOT NULL,backdrop TEXT,description TEXT,watch_url TEXT,trailer_url TEXT,featured INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS seasons(id INTEGER PRIMARY KEY AUTOINCREMENT,title_id INTEGER NOT NULL,season_number INTEGER NOT NULL,name TEXT,UNIQUE(title_id,season_number),FOREIGN KEY(title_id) REFERENCES titles(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS episodes(id INTEGER PRIMARY KEY AUTOINCREMENT,season_id INTEGER NOT NULL,episode_number INTEGER NOT NULL,title TEXT NOT NULL,description TEXT,thumbnail TEXT,watch_url TEXT,duration TEXT,UNIQUE(season_id,episode_number),FOREIGN KEY(season_id) REFERENCES seasons(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL,title_id INTEGER NOT NULL,PRIMARY KEY(user_id,title_id));
CREATE TABLE IF NOT EXISTS progress(user_id INTEGER NOT NULL,title_id INTEGER NOT NULL,episode_id INTEGER DEFAULT NULL,seconds REAL DEFAULT 0,duration REAL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,title_id,episode_id));
`);
const hash=p=>crypto.createHash("sha256").update(p).digest("hex");
const adminEmail=process.env.ADMIN_EMAIL||"admin@nexuxfilmes.com",adminPass=process.env.ADMIN_PASSWORD||"Nexux@123";
if(!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail))db.prepare("INSERT INTO users(name,email,password_hash,is_admin) VALUES(?,?,?,1)").run("Administrador",adminEmail,hash(adminPass));
if(!db.prepare("SELECT id FROM titles LIMIT 1").get())db.prepare("INSERT INTO titles(title,type,year,genre,rating,poster,backdrop,description,watch_url,featured) VALUES(?,?,?,?,?,?,?,?,?,1)").run("Bem-vindo ao NEXUX","movie","2026","Demonstração","9.0","https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=700&q=80","https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1800&q=85","Título de demonstração do NEXUX FILMES.","https://example.com",1);

app.use(express.json({limit:"3mb"}));
app.use(session({secret:process.env.SESSION_SECRET||"change-this-nexux-secret",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000}}));
app.use(express.static(path.join(__dirname,"public")));
const me=r=>r.session.user;
const auth=(r,s,n)=>me(r)?n():s.status(401).json({error:"Faça login."});
const adm=(r,s,n)=>me(r)?.is_admin?n():s.status(403).json({error:"Somente administrador."});

app.post("/api/auth/login",(r,s)=>{const x=r.body||{},u=db.prepare("SELECT * FROM users WHERE email=?").get(String(x.email||"").trim().toLowerCase());if(!u||u.password_hash!==hash(String(x.password||"")))return s.status(401).json({error:"E-mail ou senha incorretos."});r.session.user={id:u.id,name:u.name,email:u.email,is_admin:!!u.is_admin};s.json(r.session.user)});
app.post("/api/auth/register",(r,s)=>{const x=r.body||{};if(!x.name||!x.email||String(x.password||"").length<6)return s.status(400).json({error:"Preencha nome, e-mail e senha de 6+ caracteres."});try{const z=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(String(x.name).trim(),String(x.email).trim().toLowerCase(),hash(x.password));r.session.user={id:z.lastInsertRowid,name:x.name,email:String(x.email).trim().toLowerCase(),is_admin:false};s.status(201).json(r.session.user)}catch{s.status(409).json({error:"E-mail já cadastrado."})}});
app.post("/api/auth/logout",(r,s)=>r.session.destroy(()=>s.json({ok:true})));
app.get("/api/auth/me",(r,s)=>s.json(me(r)||null));

function catalog(uid=0){
 const ts=db.prepare(`SELECT t.*,CASE WHEN f.user_id IS NULL THEN 0 ELSE 1 END favorite FROM titles t LEFT JOIN favorites f ON f.title_id=t.id AND f.user_id=? ORDER BY t.featured DESC,t.created_at DESC`).all(uid);
 const ss=db.prepare("SELECT * FROM seasons ORDER BY season_number").all(),es=db.prepare("SELECT * FROM episodes ORDER BY episode_number").all();
 return ts.map(t=>({...t,seasons:ss.filter(a=>a.title_id===t.id).map(a=>({...a,episodes:es.filter(e=>e.season_id===a.id)}))}));
}
app.get("/api/catalog",(r,s)=>s.json(catalog(me(r)?.id||0)));
app.get("/api/catalog/:id",(r,s)=>{const x=catalog(me(r)?.id||0).find(a=>a.id==r.params.id);x?s.json(x):s.status(404).json({error:"Não encontrado."})});

app.post("/api/favorites/:id",auth,(r,s)=>{const u=me(r).id,t=+r.params.id,e=db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND title_id=?").get(u,t);e?db.prepare("DELETE FROM favorites WHERE user_id=? AND title_id=?").run(u,t):db.prepare("INSERT INTO favorites VALUES(?,?)").run(u,t);s.json({favorite:!e})});
app.get("/api/favorites",auth,(r,s)=>s.json(db.prepare("SELECT t.* FROM titles t JOIN favorites f ON f.title_id=t.id WHERE f.user_id=? ORDER BY f.rowid DESC").all(me(r).id)));
app.get("/api/progress",auth,(r,s)=>s.json(db.prepare("SELECT p.*,t.title,t.poster,t.type FROM progress p JOIN titles t ON t.id=p.title_id WHERE p.user_id=? ORDER BY p.updated_at DESC").all(me(r).id)));
app.post("/api/progress",auth,(r,s)=>{const x=r.body||{};db.prepare(`INSERT INTO progress(user_id,title_id,episode_id,seconds,duration,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,title_id,episode_id) DO UPDATE SET seconds=excluded.seconds,duration=excluded.duration,updated_at=CURRENT_TIMESTAMP`).run(me(r).id,+x.title_id,x.episode_id?+x.episode_id:null,+x.seconds||0,+x.duration||0);s.json({ok:true})});

app.post("/api/admin/titles",adm,(r,s)=>{const x=r.body||{};if(!x.title||!x.poster)return s.status(400).json({error:"Título e capa são obrigatórios."});const z=db.prepare(`INSERT INTO titles(title,type,year,genre,rating,poster,backdrop,description,watch_url,trailer_url,featured) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(x.title,x.type==="series"?"series":"movie",x.year||"",x.genre||"",x.rating||"",x.poster,x.backdrop||x.poster,x.description||"",x.watch_url||"",x.trailer_url||"",x.featured?1:0);s.status(201).json(db.prepare("SELECT * FROM titles WHERE id=?").get(z.lastInsertRowid))});
app.put("/api/admin/titles/:id",adm,(r,s)=>{const x=r.body||{};db.prepare(`UPDATE titles SET title=?,type=?,year=?,genre=?,rating=?,poster=?,backdrop=?,description=?,watch_url=?,trailer_url=?,featured=? WHERE id=?`).run(x.title,x.type==="series"?"series":"movie",x.year||"",x.genre||"",x.rating||"",x.poster,x.backdrop||x.poster,x.description||"",x.watch_url||"",x.trailer_url||"",x.featured?1:0,+r.params.id);s.json({ok:true})});
app.delete("/api/admin/titles/:id",adm,(r,s)=>{db.prepare("DELETE FROM titles WHERE id=?").run(+r.params.id);s.json({ok:true})});

app.post("/api/admin/seasons",adm,(r,s)=>{const x=r.body||{};try{const z=db.prepare("INSERT INTO seasons(title_id,season_number,name) VALUES(?,?,?)").run(+x.title_id,+x.season_number,x.name||`Temporada ${x.season_number}`);s.status(201).json(db.prepare("SELECT * FROM seasons WHERE id=?").get(z.lastInsertRowid))}catch{ s.status(409).json({error:"Essa temporada já existe."})}});
app.put("/api/admin/seasons/:id",adm,(r,s)=>{const x=r.body||{};db.prepare("UPDATE seasons SET season_number=?,name=? WHERE id=?").run(+x.season_number,x.name,+r.params.id);s.json({ok:true})});
app.delete("/api/admin/seasons/:id",adm,(r,s)=>{db.prepare("DELETE FROM seasons WHERE id=?").run(+r.params.id);s.json({ok:true})});
app.post("/api/admin/episodes",adm,(r,s)=>{const x=r.body||{};if(!x.title)return s.status(400).json({error:"Nome do episódio obrigatório."});try{const z=db.prepare("INSERT INTO episodes(season_id,episode_number,title,description,thumbnail,watch_url,duration) VALUES(?,?,?,?,?,?,?)").run(+x.season_id,+x.episode_number,x.title,x.description||"",x.thumbnail||"",x.watch_url||"",x.duration||"");s.status(201).json(db.prepare("SELECT * FROM episodes WHERE id=?").get(z.lastInsertRowid))}catch{s.status(409).json({error:"Esse episódio já existe nessa temporada."})}});
app.put("/api/admin/episodes/:id",adm,(r,s)=>{const x=r.body||{};db.prepare("UPDATE episodes SET episode_number=?,title=?,description=?,thumbnail=?,watch_url=?,duration=? WHERE id=?").run(+x.episode_number,x.title,x.description||"",x.thumbnail||"",x.watch_url||"",x.duration||"",+r.params.id);s.json({ok:true})});
app.delete("/api/admin/episodes/:id",adm,(r,s)=>{db.prepare("DELETE FROM episodes WHERE id=?").run(+r.params.id);s.json({ok:true})});

app.get("*",(r,s)=>s.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("NEXUX FILMES V3 na porta "+PORT));