//! Book moment rules using Windows locale data and the current system time zone.
use super::wide;
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{FILETIME, SYSTEMTIME},
        Globalization::*,
        System::Time::*,
    },
};
unsafe fn local(ms: f64) -> Option<SYSTEMTIME> {
    if !ms.is_finite() || ms < -11_644_473_600_000. || ms > 8.64e15 {
        return None;
    }
    let ticks = ((ms + 11_644_473_600_000.) * 10_000.) as u64;
    let file = FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    };
    let (mut utc, mut local) = (SYSTEMTIME::default(), SYSTEMTIME::default());
    FileTimeToSystemTime(&file, &mut utc).ok()?;
    SystemTimeToTzSpecificLocalTimeEx(None, &utc, &mut local).ok()?;
    Some(local)
}
unsafe fn locale_info(locale: PCWSTR, kind: u32) -> Option<String> {
    let mut out = [0u16; 256];
    let n = GetLocaleInfoEx(locale, kind, Some(&mut out));
    (n > 0).then(|| String::from_utf16_lossy(&out[..n as usize - 1]))
}
pub(crate) fn moment_ui(ms: f64, now: f64, lang: &str) -> String {
    unsafe {
        let (Some(value), Some(now)) = (local(ms), local(now)) else {
            return "—".into();
        };
        let language = wide(crate::languages::locale(lang));
        let locale = PCWSTR(language.as_ptr());
        let mut time = [0u16; 128];
        let n = GetTimeFormatEx(
            locale,
            TIME_NOSECONDS,
            Some(&value),
            PCWSTR::null(),
            Some(&mut time),
        );
        if n <= 0 {
            return format!("{:02}:{:02}", value.wHour, value.wMinute);
        }
        let time = String::from_utf16_lossy(&time[..n as usize - 1]);
        if (value.wYear, value.wMonth, value.wDay) == (now.wYear, now.wMonth, now.wDay) {
            return time;
        }
        let mut pattern = locale_info(locale, LOCALE_SMONTHDAY)
            .unwrap_or_else(|| "MMM d".into())
            .replace("MMMM", "MMM")
            .replace("dd", "d");
        if value.wYear != now.wYear {
            let year_month = locale_info(locale, LOCALE_SYEARMONTH).unwrap_or_default();
            let year = year_month.find('y');
            let month = year_month.find('M');
            if year.zip(month).is_some_and(|(y, m)| y < m) {
                pattern = format!("{}{}", &year_month[..month.unwrap()], pattern);
            } else {
                pattern.push_str(if lang == "en" { ", yyyy" } else { " yyyy" });
            }
        }
        let pattern = wide(pattern);
        let mut date = [0u16; 256];
        let n = GetDateFormatEx(
            locale,
            ENUM_DATE_FORMATS_FLAGS(0),
            Some(&value),
            PCWSTR(pattern.as_ptr()),
            Some(&mut date),
            PCWSTR::null(),
        );
        if n <= 0 {
            return time;
        }
        format!(
            "{}{}{}",
            String::from_utf16_lossy(&date[..n as usize - 1]),
            if ["zh", "zh-Hant", "ja"].contains(&lang) {
                ""
            } else {
                " "
            },
            time
        )
    }
}
