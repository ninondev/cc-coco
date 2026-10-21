//! System ICU/NLS formatting of the book's moment rule; no application data is read.
pub fn parse_reset(v: &serde_json::Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        return (n.is_finite() && (0.0..=8.64e15).contains(&n)).then_some(n);
    }
    let s = v.as_str()?;
    let (date, time) = s.split_once('T')?;
    let d = date
        .split('-')
        .map(str::parse::<i64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if d.len() != 3 {
        return None;
    }
    let (y, m, day) = (d[0], d[1], d[2]);
    if !(0..=275760).contains(&y) {
        return None;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1..=12).contains(&m) || day < 1 || day > days[(m - 1) as usize] {
        return None;
    }
    let (clock, zone) = if let Some(t) = time.strip_suffix('Z') {
        (t, 0)
    } else {
        let pos = time
            .char_indices()
            .find(|(i, c)| *i > 0 && (*c == '+' || *c == '-'))
            .map(|(i, _)| i)?;
        let z = &time[pos + 1..];
        let (h, m) = z.split_once(':')?;
        let (h, m) = (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?);
        if !(0..=23).contains(&h) || !(0..=59).contains(&m) {
            return None;
        }
        (
            &time[..pos],
            (h * 60 + m) * 60 * if time.as_bytes()[pos] == b'+' { 1 } else { -1 },
        )
    };
    let t = clock.split(':').collect::<Vec<_>>();
    if t.len() != 3 {
        return None;
    }
    let (h, min, sec) = (
        t[0].parse::<i64>().ok()?,
        t[1].parse::<i64>().ok()?,
        t[2].parse::<f64>().ok()?,
    );
    if !(0..24).contains(&h)
        || !(0..60).contains(&min)
        || !sec.is_finite()
        || !(0.0..60.0).contains(&sec)
    {
        return None;
    }
    let y = y - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yo = y - era * 400;
    let mo = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mo + 2) / 5 + day - 1;
    let doe = yo * 365 + yo / 4 - yo / 100 + doy;
    {
        let result = ((era * 146097 + doe - 719468) * 86400 + h * 3600 + min * 60 - zone) as f64
            * 1000.
            + sec * 1000.;
        (0.0..=8.64e15).contains(&result).then_some(result)
    }
}
pub fn moment(ms: f64, now: f64, lang: &str) -> String {
    #[cfg(windows)]
    {
        crate::platform::windows::moment_ui(ms, now, lang)
    }
    #[cfg(unix)]
    {
        icu::moment(ms, now, lang).unwrap_or_else(|| "—".into())
    }
}
#[cfg(unix)]
mod icu {
    use std::{
        ffi::{c_char, c_void, CString},
        sync::OnceLock,
    };
    type Open = unsafe extern "C" fn(
        i32,
        i32,
        *const c_char,
        *const u16,
        i32,
        *const u16,
        i32,
        *mut i32,
    ) -> *mut c_void;
    type Close = unsafe extern "C" fn(*mut c_void);
    type Format =
        unsafe extern "C" fn(*const c_void, f64, *mut u16, i32, *mut c_void, *mut i32) -> i32;
    type PgOpen = unsafe extern "C" fn(*const c_char, *mut i32) -> *mut c_void;
    type Pattern =
        unsafe extern "C" fn(*mut c_void, *const u16, i32, *mut u16, i32, *mut i32) -> i32;
    struct Api {
        open: Open,
        close: Close,
        format: Format,
        pg_open: PgOpen,
        pg_close: Close,
        pattern: Pattern,
    }
    unsafe impl Send for Api {}
    unsafe impl Sync for Api {}
    fn api() -> Option<&'static Api> {
        static API: OnceLock<Option<Api>> = OnceLock::new();
        API.get_or_init(|| unsafe {
            #[cfg(target_os = "macos")]
            let name = c"/usr/lib/libicucore.A.dylib";
            #[cfg(target_os = "linux")]
            let name = c"libicui18n.so";
            #[allow(unused_mut)]
            let mut lib = libc::dlopen(name.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
            #[cfg(target_os = "linux")]
            if lib.is_null() {
                for version in (50..=110).rev() {
                    let n = CString::new(format!("libicui18n.so.{version}")).unwrap();
                    lib = libc::dlopen(n.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
                    if !lib.is_null() {
                        break;
                    }
                }
            }
            if lib.is_null() {
                return None;
            }
            let sym = |name: &str| {
                for ver in std::iter::once(String::new()).chain((50..=110).map(|v| format!("_{v}")))
                {
                    let n = CString::new(format!("{name}{ver}")).unwrap();
                    let p = libc::dlsym(lib, n.as_ptr());
                    if !p.is_null() {
                        return Some(p);
                    }
                }
                None
            };
            Some(Api {
                open: std::mem::transmute::<*mut c_void, Open>(sym("udat_open")?),
                close: std::mem::transmute::<*mut c_void, Close>(sym("udat_close")?),
                format: std::mem::transmute::<*mut c_void, Format>(sym("udat_format")?),
                pg_open: std::mem::transmute::<*mut c_void, PgOpen>(sym("udatpg_open")?),
                pg_close: std::mem::transmute::<*mut c_void, Close>(sym("udatpg_close")?),
                pattern: std::mem::transmute::<*mut c_void, Pattern>(sym("udatpg_getBestPattern")?),
            })
        })
        .as_ref()
    }
    fn format(a: &Api, ms: f64, locale: &CString, skeleton: &str) -> Option<String> {
        unsafe {
            let mut err = 0;
            let pg = (a.pg_open)(locale.as_ptr(), &mut err);
            if pg.is_null() || err > 0 {
                return None;
            }
            let sk = skeleton.encode_utf16().collect::<Vec<_>>();
            let mut pattern = [0u16; 160];
            let n = (a.pattern)(
                pg,
                sk.as_ptr(),
                sk.len() as i32,
                pattern.as_mut_ptr(),
                160,
                &mut err,
            );
            (a.pg_close)(pg);
            if err > 0 || n > 160 {
                return None;
            }
            let f = (a.open)(
                -2,
                -2,
                locale.as_ptr(),
                std::ptr::null(),
                0,
                pattern.as_ptr(),
                n,
                &mut err,
            );
            if f.is_null() || err > 0 {
                return None;
            }
            let mut out = [0u16; 256];
            let n = (a.format)(f, ms, out.as_mut_ptr(), 256, std::ptr::null_mut(), &mut err);
            (a.close)(f);
            if err > 0 || n < 0 || n > 256 {
                return None;
            }
            String::from_utf16(&out[..n as usize]).ok()
        }
    }
    pub fn moment(ms: f64, now: f64, lang: &str) -> Option<String> {
        if !ms.is_finite() || ms.abs() > 8.64e15 {
            return None;
        }
        let a = api()?;
        let locale = CString::new(crate::languages::locale(lang).replace('-', "_")).ok()?;
        let (mut t, mut today): (libc::tm, libc::tm) = unsafe { std::mem::zeroed() };
        unsafe {
            let sec = (ms / 1000.) as libc::time_t;
            let ns = (now / 1000.) as libc::time_t;
            if libc::localtime_r(&sec, &mut t).is_null()
                || libc::localtime_r(&ns, &mut today).is_null()
            {
                return None;
            }
        }
        let time = format(a, ms, &locale, "jmm")?;
        if t.tm_year == today.tm_year && t.tm_yday == today.tm_yday {
            Some(time)
        } else {
            Some(format!(
                "{}{}{}",
                format(
                    a,
                    ms,
                    &locale,
                    if t.tm_year == today.tm_year {
                        "MMMd"
                    } else {
                        "yMMMd"
                    }
                )?,
                if matches!(lang, "zh" | "zh-Hant" | "ja") { "" } else { " " },
                time
            ))
        }
    }
}
pub fn percent(value: f64, lang: &str) -> String {
    let rounded = format!("{:.0}", value.round());
    // Intl's percent separator in the supported locales; numbers are already bounded.
    match lang {
        "fr" => format!("{rounded}\u{a0}%"),
        "de" | "es-ES" => format!("{rounded}\u{a0}%"),
        _ => format!("{rounded}%"),
    }
}
