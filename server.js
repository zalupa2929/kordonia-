const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
fs.mkdirSync(DATA_DIR, {recursive:true});
fs.mkdirSync(UPLOAD_DIR, {recursive:true});
const db = new Database(path.join(DATA_DIR, "kordrp.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const ORGS = {
 "Правительство": ["Контролёр доступа","Глава протокольной безопасности","Хранитель реестра","Аналитик стратегических рисков","Магистр регламентов","Председатель Государственной Думы","Депутат","Вице-губернатор","Губернатор","Министр социальной политики","Заместитель премьер-министра","Премьер-министр"],
 "Кордоновский суд": ["Председатель Городского суда","Главный районный судья","Районный судья","Судья по уголовным делам","Судья по гражданским делам","Следственный судья","Судебный медиатор","Судебный эксперт","Секретарь судебного заседания","Судебный пристав","Помощник судьи","Практикант"],
 "СК": ["Младший лейтенант юстиции","Лейтенант юстиции","Старший лейтенант юстиции","Капитан юстиции","Майор юстиции","Подполковник юстиции","Полковник юстиции","Генерал-майор юстиции","Генерал-лейтенант юстиции","Генерал-полковник юстиции","Генерал юстиции"],
 "Прокуратура": ["Младший юрист","Юрист 3 класса","Юрист 2 класса","Юрист 1 класса","Младший советник юстиции","Советник юстиции","Старший советник юстиции","Государственный советник юстиции 3 класса","Государственный советник юстиции 2 класса","Государственный советник юстиции 1 класса","Действительный государственный советник юстиции"],
 "ДГБ": ["Младший оперуполномоченный","Оперуполномоченный","Старший оперуполномоченный","Заместитель начальника отдела","Начальник отдела","Генерал","Генерал-полковник","Генерал-лейтенант","Генерал-майор","Полковник","Подполковник","Майор","Капитан","Старший лейтенант","Лейтенант","Младший лейтенант","Старший прапорщик","Прапорщик","Старшина","Старший сержант","Сержант","Младший сержант"],
 "КНД": ["Генерал-полковник полиции","Генерал-лейтенант полиции","Генерал-майор полиции","Полковник полиции","Подполковник полиции","Майор полиции","Капитан полиции","Старший лейтенант полиции","Лейтенант полиции","Младший лейтенант полиции","Старший прапорщик полиции","Прапорщик полиции","Старшина полиции","Старший сержант полиции","Сержант полиции","Младший сержант полиции","Рядовой полиции"],
 "МВД": ["Генерал полиции","Генерал-полковник полиции","Генерал-лейтенант полиции","Генерал-майор полиции","Полковник полиции","Подполковник полиции","Майор полиции","Капитан полиции","Старший лейтенант полиции","Лейтенант полиции","Младший лейтенант полиции","Старший прапорщик полиции","Прапорщик полиции","Старшина полиции","Старший сержант полиции","Сержант полиции","Младший сержант полиции","Рядовой полиции"],
 "ВС РК": ["Рядовой","Ефрейтор","Младший сержант","Сержант","Старший сержант","Старшина","Прапорщик","Старший прапорщик","Младший лейтенант","Лейтенант","Старший лейтенант","Капитан","Майор","Подполковник","Полковник","Генерал-майор","Генерал-лейтенант","Генерал-полковник","Генерал армии"],
 "ГБ": ["Главный врач","Зам. главного врача","Заведующий отделением","Зам. заведующего отделением","Врач-психиатр","Врач-нарколог","Врач-реаниматолог","Врач-хирург","Врач-травматолог","Врач-терапевт","Старший парамедик","Парамедик","Фельдшер","Медбрат / Медсестра","Санитар","Интерн"],
 "СМИ": ["Генеральный директор","Зам. генерального директора","Управляющий СМИ","Главный редактор","Зам. главного редактора","Режиссёр","Ведущий","Журналист","Репортёр","Оператор","Радиоведущий","Корреспондент","Фотокорреспондент","Верстальщик","Помощник редактора","Стажёр"]
};

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'viewer', org TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS staff (
 id TEXT PRIMARY KEY, fio TEXT NOT NULL, dob TEXT, passport TEXT, phone TEXT, nickname TEXT, discord TEXT,
 token TEXT UNIQUE NOT NULL, org TEXT NOT NULL, unit TEXT, position TEXT NOT NULL, rank TEXT,
 status TEXT NOT NULL DEFAULT 'Служит', portrait_path TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS credentials (
 id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
 credential_no TEXT UNIQUE NOT NULL, issued_on TEXT, expires_on TEXT, status TEXT NOT NULL DEFAULT 'Действует',
 issuer TEXT, image_path TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT, fio TEXT NOT NULL, org TEXT, action TEXT NOT NULL,
 details TEXT, actor TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS training (
 id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
 course TEXT NOT NULL, result TEXT NOT NULL, date TEXT NOT NULL, examiner TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS access_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, action TEXT NOT NULL, target TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
function log(action,target="",username="system"){db.prepare("INSERT INTO access_log(username,action,target) VALUES(?,?,?)").run(username,action,String(target));}
function audit(staff,action,details="",actor="system"){db.prepare("INSERT INTO history(staff_id,fio,org,action,details,actor) VALUES(?,?,?,?,?,?)").run(staff?.id||null,staff?.fio||"—",staff?.org||"—",action,details,actor);}
const adminName=process.env.ADMIN_USERNAME || "admin";
const adminPass=process.env.ADMIN_PASSWORD || "change-this-immediately";
if(!db.prepare("SELECT id FROM users WHERE username=?").get(adminName)){
 db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,?)").run(adminName,bcrypt.hashSync(adminPass,12),"main_admin");
 console.log("Initial admin created from ADMIN_USERNAME / ADMIN_PASSWORD environment variables.");
}
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:false}));
app.use(session({store:new SQLiteStore({db:"sessions.sqlite",dir:DATA_DIR}),secret:process.env.SESSION_SECRET||"development-only-change-me",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:8*60*60*1000}}));
app.use("/uploads",express.static(UPLOAD_DIR,{fallthrough:false, dotfiles:"deny"}));
const upload=multer({storage:multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:3*1024*1024},fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(file.mimetype))});
function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:"Требуется вход"});next();}
function role(...roles){return (req,res,next)=>{if(!req.session.user)return res.status(401).json({error:"Требуется вход"});if(!roles.includes(req.session.user.role)&&req.session.user.role!=="main_admin")return res.status(403).json({error:"Недостаточно прав"});next();};}
function canManageOrg(req,org){return req.session.user.role==="main_admin"||req.session.user.role==="technical_admin"||(["org_head","hr"].includes(req.session.user.role)&&req.session.user.org===org);}
function safePublic(s,c){return {fio:s.fio,token:s.token,org:s.org,unit:s.unit,position:s.position,rank:s.rank,status:s.status,credential_no:c?.credential_no||"",issued_on:c?.issued_on||"",expires_on:c?.expires_on||"",credential_status:c?.status||"Нет удостоверения",portrait_path:s.portrait_path||null,image_path:c?.image_path||null};}
function staffRow(id){return db.prepare("SELECT * FROM staff WHERE id=?").get(id);}
function credFor(id){return db.prepare("SELECT * FROM credentials WHERE staff_id=? ORDER BY id DESC LIMIT 1").get(id);}
app.get("/api/config",(req,res)=>res.json({orgs:ORGS,user:req.session.user?{username:req.session.user.username,role:req.session.user.role,org:req.session.user.org}:null}));
app.post("/api/login",(req,res)=>{const {username,password}=req.body||{};const u=db.prepare("SELECT * FROM users WHERE username=? AND active=1").get(String(username||""));if(!u||!bcrypt.compareSync(String(password||""),u.password_hash)){log("Неудачный вход",username||"");return res.status(401).json({error:"Неверный логин или пароль"});}req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Ошибка сессии"});req.session.user={id:u.id,username:u.username,role:u.role,org:u.org};log("Вход в систему","",u.username);res.json({ok:true,user:req.session.user});});});
app.post("/api/logout",auth,(req,res)=>{log("Выход","",req.session.user.username);req.session.destroy(()=>res.json({ok:true}));});
app.get("/api/staff",auth,(req,res)=>{const rows=db.prepare("SELECT * FROM staff ORDER BY org,position,fio").all();const canPrivate=["main_admin","technical_admin","hr","org_head"].includes(req.session.user.role);res.json(rows.map(s=>{const x={...s};delete x.passport;delete x.phone;delete x.nickname;delete x.discord;if(canPrivate&&(req.session.user.role==="main_admin"||req.session.user.role==="technical_admin"||req.session.user.org===s.org)){x.passport=s.passport;x.phone=s.phone;x.nickname=s.nickname;x.discord=s.discord;}x.credential=credFor(s.id)||null;return x;}));});
app.post("/api/staff",role("main_admin","hr","org_head"),(req,res)=>{const b=req.body||{};if(!b.fio||!b.token||!b.org||!b.position)return res.status(400).json({error:"Заполните ФИО, жетон, организацию и должность"});if(!/^\d{3}-\d{3}$/.test(b.token))return res.status(400).json({error:"Жетон должен иметь формат 000-000"});if(!ORGS[b.org])return res.status(400).json({error:"Неизвестная организация"});if(!canManageOrg(req,b.org))return res.status(403).json({error:"Нет доступа к этой организации"});if(db.prepare("SELECT id FROM staff WHERE token=?").get(b.token))return res.status(409).json({error:"Такой жетон уже занят"});const id=crypto.randomUUID();const data={id,fio:b.fio,dob:b.dob||"",passport:b.passport||"",phone:b.phone||"",nickname:b.nickname||"",discord:b.discord||"",token:b.token,org:b.org,unit:b.unit||"",position:b.position,rank:b.rank||"",status:b.status||"Служит",portrait_path:b.portrait_path||""};db.prepare("INSERT INTO staff(id,fio,dob,passport,phone,nickname,discord,token,org,unit,position,rank,status,portrait_path) VALUES(@id,@fio,@dob,@passport,@phone,@nickname,@discord,@token,@org,@unit,@position,@rank,@status,@portrait_path)").run(data);audit(data,"Приём на службу","Создан профиль",req.session.user.username);res.json({ok:true,id});});
app.put("/api/staff/:id",role("main_admin","hr","org_head"),(req,res)=>{const old=staffRow(req.params.id);if(!old)return res.status(404).json({error:"Запись не найдена"});if(!canManageOrg(req,old.org))return res.status(403).json({error:"Нет доступа к этой организации"});const b=req.body||{},org=b.org||old.org;if(!ORGS[org]||!canManageOrg(req,org))return res.status(403).json({error:"Нет доступа к выбранной организации"});const token=b.token||old.token;if(!/^\d{3}-\d{3}$/.test(token))return res.status(400).json({error:"Неверный формат жетона"});const collision=db.prepare("SELECT id FROM staff WHERE token=? AND id<>?").get(token,old.id);if(collision)return res.status(409).json({error:"Жетон уже занят"});const data={...old,...b,org,token,updated_at:new Date().toISOString()};db.prepare("UPDATE staff SET fio=@fio,dob=@dob,passport=@passport,phone=@phone,nickname=@nickname,discord=@discord,token=@token,org=@org,unit=@unit,position=@position,rank=@rank,status=@status,portrait_path=@portrait_path,updated_at=@updated_at WHERE id=@id").run({...data,id:old.id});if(old.org!==org)audit({...data,id:old.id},"Перевод",old.org+" → "+org,req.session.user.username);if(old.rank!==data.rank)audit({...data,id:old.id},"Изменение звания",old.rank+" → "+data.rank,req.session.user.username);if(old.status!==data.status)audit({...data,id:old.id},data.status==="Уволен"?"Увольнение":"Возобновление службы","",req.session.user.username);res.json({ok:true});});
app.delete("/api/staff/:id",role("main_admin"),(req,res)=>{const s=staffRow(req.params.id);if(!s)return res.status(404).json({error:"Не найдено"});audit(s,"Удаление профиля","Удалён главным администратором",req.session.user.username);db.prepare("DELETE FROM staff WHERE id=?").run(s.id);res.json({ok:true});});
app.post("/api/staff/:id/credential",role("main_admin","hr","org_head"),(req,res)=>{const s=staffRow(req.params.id);if(!s)return res.status(404).json({error:"Сотрудник не найден"});if(!canManageOrg(req,s.org))return res.status(403).json({error:"Нет доступа"});const b=req.body||{},number=b.credential_no||"KR-"+crypto.randomBytes(4).toString("hex").toUpperCase();try{const info=db.prepare("INSERT INTO credentials(staff_id,credential_no,issued_on,expires_on,status,issuer) VALUES(?,?,?,?,?,?)").run(s.id,number,b.issued_on||new Date().toISOString().slice(0,10),b.expires_on||"",s.status==="Служит"?"Действует":"Недействительно",req.session.user.username);audit(s,"Выдача удостоверения",number,req.session.user.username);res.json({ok:true,id:info.lastInsertRowid,credential_no:number});}catch(e){res.status(409).json({error:"Номер удостоверения уже используется"});}});
app.post("/api/credentials/:id/image",role("main_admin","hr"),upload.single("image"),(req,res)=>{if(!req.file)return res.status(400).json({error:"Выберите JPG, PNG или WEBP до 3 МБ"});const c=db.prepare("SELECT * FROM credentials WHERE id=?").get(req.params.id);if(!c)return res.status(404).json({error:"Удостоверение не найдено"});const p="/uploads/"+req.file.filename;db.prepare("UPDATE credentials SET image_path=? WHERE id=?").run(p,c.id);const s=staffRow(c.staff_id);audit(s,"Загрузка изображения удостоверения",c.credential_no,req.session.user.username);res.json({ok:true,image_path:p});});
app.get("/api/history",role("main_admin","technical_admin","hr","org_head","investigator"),(req,res)=>{const rows=db.prepare("SELECT * FROM history ORDER BY id DESC LIMIT 500").all();res.json(rows.filter(x=>req.session.user.role==="main_admin"||req.session.user.role==="technical_admin"||req.session.user.role==="investigator"||req.session.user.org===x.org));});
app.get("/api/training",auth,(req,res)=>{const rows=db.prepare("SELECT t.*,s.org FROM training t JOIN staff s ON s.id=t.staff_id ORDER BY t.id DESC").all();res.json(rows.filter(x=>req.session.user.role==="main_admin"||req.session.user.role==="technical_admin"||req.session.user.org===x.org));});
app.post("/api/training",role("main_admin","hr","org_head"),(req,res)=>{const b=req.body||{},s=staffRow(b.staff_id);if(!s)return res.status(404).json({error:"Сотрудник не найден"});if(!canManageOrg(req,s.org))return res.status(403).json({error:"Нет доступа"});db.prepare("INSERT INTO training(staff_id,course,result,date,examiner,notes) VALUES(?,?,?,?,?,?)").run(s.id,b.course,b.result,b.date,b.examiner||"",b.notes||"");audit(s,"Запись об аттестации",b.course+" — "+b.result,req.session.user.username);res.json({ok:true});});
app.get("/api/verify/:token",auth,(req,res)=>{const token=String(req.params.token||"");if(!/^\d{3}-\d{3}$/.test(token))return res.status(400).json({error:"Введите жетон в формате 000-000"});const s=db.prepare("SELECT * FROM staff WHERE token=?").get(token);if(!s)return res.status(404).json({found:false,error:"Сотрудник с таким жетоном не найден"});const c=credFor(s.id);const expired=c?.expires_on&&c.expires_on<new Date().toISOString().slice(0,10);const valid=s.status==="Служит"&&c&&c.status==="Действует"&&!expired;log("Публичная проверка жетона",token,"public");res.json({found:true,valid:!!valid,...safePublic(s,c)});});
app.get("/api/my-case",auth,(req,res)=>{const u=req.session.user;const s=db.prepare("SELECT * FROM staff WHERE lower(nickname)=lower(?) OR lower(discord)=lower(?) ORDER BY id LIMIT 1").get(u.username,u.username);if(!s)return res.json({found:false});const c=credFor(s.id);const safe={id:s.id,fio:s.fio,dob:s.dob,phone:s.phone,token:s.token,org:s.org,unit:s.unit,position:s.position,rank:s.rank,status:s.status,portrait_path:s.portrait_path,credential:c?{credential_no:c.credential_no,issued_on:c.issued_on,expires_on:c.expires_on,status:c.status}:null};const rows=db.prepare("SELECT action,details,created_at FROM history WHERE staff_id=? ORDER BY id DESC LIMIT 100").all(s.id);res.json({found:true,staff:safe,history:rows});});
app.get("/api/public/organizations",(req,res)=>res.json(ORGS));
app.get("/api/users",role("main_admin"),(req,res)=>res.json(db.prepare("SELECT id,username,role,org,active,created_at FROM users ORDER BY username").all()));
app.post("/api/users",role("main_admin"),(req,res)=>{const b=req.body||{};if(!b.username||!b.password||!["technical_admin","org_head","hr","investigator","viewer"].includes(b.role))return res.status(400).json({error:"Проверьте логин, пароль и роль"});try{db.prepare("INSERT INTO users(username,password_hash,role,org) VALUES(?,?,?,?)").run(b.username,bcrypt.hashSync(b.password,12),b.role,b.org||null);res.json({ok:true});}catch(e){res.status(409).json({error:"Такой логин уже существует"});}});
app.get("/api/audit",role("main_admin","technical_admin"),(req,res)=>res.json(db.prepare("SELECT * FROM access_log ORDER BY id DESC LIMIT 500").all()));
app.use(express.static(path.join(__dirname,"public")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`KordRP registry listening on ${PORT}`));
