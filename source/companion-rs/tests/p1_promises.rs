use coco_companion::{engine::Engine,feed::Record,render::Size,Options};
use std::path::PathBuf;
static MEASUREMENT_LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());
fn fixture() -> (PathBuf,Engine) {
    static NEXT:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
    let root=std::env::temp_dir().join(format!("p1-native-{}-{}-{}",std::process::id(),coco_companion::epoch_ms(),NEXT.fetch_add(1,std::sync::atomic::Ordering::Relaxed)));
    std::fs::create_dir_all(&root).unwrap();
    let options=Options{folder:root.clone(),presence_folder:None,assets:PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../assets"),size:Size::Medium,reduce_motion:false,follow_class:None,trace:false,login:false};
    let engine=Engine::new(options,1000,42).unwrap();(root,engine)
}
fn idle() -> Record {let mut record=Record::resting();record.session="p1".into();record.at=1000.;record.reactions.clear();record}
#[test]
fn p1_hidden_asleep_and_reduce_motion_remove_animation_deadlines() {
    let _serial=MEASUREMENT_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    let (root,mut engine)=fixture();
    engine.preview_record(idle(),1000);engine.render(1000,1.);
    assert!(engine.next_deadline_ms(1000).is_some());
    engine.set_visible(false);
    assert_eq!(engine.next_deadline_ms(1000),None,"hidden has no animation callback");
    engine.set_visible(true);
    let mut sleep=idle();sleep.mood="sleep".into();sleep.frame="sleep".into();
    engine.preview_record(sleep,1000);engine.render(1000,1.);
    assert_eq!(engine.next_deadline_ms(1000),None,"asleep has no animation callback");
    engine.options.reduce_motion=true;engine.preview_record(idle(),1000);
    let still=engine.render(1000,1.);assert_eq!(engine.next_deadline_ms(1000),None,"reduced idle has no blink callback");
    assert_eq!(still.pixels,engine.render(60000,1.).pixels,"reduced idle remains still");
    drop(engine);std::fs::remove_dir_all(root).unwrap();
}
#[cfg(target_os="macos")]
fn rss()->u64 {
    #[repr(C)] struct Basic {virtual_size:u64,resident_size:u64,resident_size_max:u64,user:[i32;2],system:[i32;2],policy:i32,suspend:i32}
    unsafe extern "C" {static mach_task_self_:u32;fn task_info(task:u32,flavor:u32,info:*mut i32,count:*mut u32)->i32;}
    unsafe {let mut basic:Basic=std::mem::zeroed();let mut count=(std::mem::size_of::<Basic>()/4) as u32;assert_eq!(task_info(mach_task_self_,20,(&mut basic as *mut Basic).cast(),&mut count),0);basic.resident_size}
}
#[cfg(target_os="linux")]
fn rss()->u64 {let text=std::fs::read_to_string("/proc/self/statm").unwrap();text.split_whitespace().nth(1).unwrap().parse::<u64>().unwrap()*unsafe {libc::sysconf(libc::_SC_PAGESIZE)} as u64}
#[cfg(any(target_os="macos",target_os="linux"))]
#[test]
fn p1_headless_renderer_rss_stays_in_recorded_budget() {
    let _serial=MEASUREMENT_LOCK.lock().unwrap_or_else(|error|error.into_inner());
    let (root,mut engine)=fixture();let mut values=serde_json::Map::new();
    engine.options.reduce_motion=true;
    engine.preview_record(idle(),1000);let mut canvas=engine.render(1000,1.);
    values.insert("quiet".into(),rss().into());engine.options.reduce_motion=false;
    engine.preview_record(idle(),1000);
    for at in [1000,2500,5000,10000,20000] {canvas=engine.render(at,1.);std::hint::black_box(&canvas);}
    values.insert("idle".into(),rss().into());
    let mut work=idle();work.mood="work".into();work.frame="work-a".into();work.rest=false;work.loop_frames=Some(["work-a".into(),"work-b".into()]);work.every=Some(330.);
    engine.preview_record(work,1000);
    for at in [1000,1330,1660,2000,2500] {canvas=engine.render(at,1.);std::hint::black_box(&canvas);}
    values.insert("work".into(),rss().into());
    std::hint::black_box(&canvas);
    println!("P1_RSS {}",serde_json::Value::Object(values.clone()));
    let peak=values.values().map(|v|v.as_u64().unwrap()).max().unwrap();assert!(peak>0,"RSS unavailable");
    if std::env::var_os("P1_RSS_RECORD_ONLY").is_none() {
        let path=std::env::var_os("P1_RSS_BUDGET").map(PathBuf::from).unwrap_or_else(||PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tools/budgets/companion-rss.json"));
        let budget:serde_json::Value=serde_json::from_slice(&std::fs::read(path).expect("recorded RSS budget is required")).unwrap();
        let key=format!("rust-{}-{}",std::env::consts::OS,std::env::consts::ARCH);
        let limit=budget["measurements"][key]["limitBytes"].as_u64().expect("no RSS baseline for this platform; measure headless fixture before claiming C12");
        assert!(peak<=limit,"RSS {peak} exceeds {limit} byte budget; headless renderer only, native shells excluded");
    }
    drop(engine);std::fs::remove_dir_all(root).unwrap();
}
