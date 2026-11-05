use super::*;
use std::cell::{Cell, RefCell};

#[test]
fn only_exact_session_names_are_swept() {
    for (name, kind) in [
        (".presence-registration-A_1-x", SessionKind::Registration),
        (".presence-follow-A_1-x.jsonl", SessionKind::Marker),
        (".presence-deadline-A_1-x.jsonl", SessionKind::Deadline),
    ] {
        assert_eq!(session_name(name), Some((kind, "A_1-x")));
    }
    for name in [
        "snapshot.json",
        "presence.jsonl",
        ".presence-x",
        ".presence-registration-",
        ".presence-follow-x.jsonl.stage",
        ".presence-deadline-x.1-2.stage",
        ".presence-follow-../x.jsonl",
        ".presence-registration-foreign.user",
        ".presence-deadline-x.JSONL",
    ] {
        assert_eq!(session_name(name), None, "{name}");
    }
    assert!(session_name(&format!(".presence-registration-{}", "a".repeat(129))).is_none());
}

#[test]
fn ambiguous_receipts_are_preserved() {
    let valid = protocol::receipt(42, 12, "windows:1234", 0, r"C:\Coco\coco-companion.exe", "one");
    assert_eq!(session_receipt(valid.as_bytes(), "one"), Some((42, 1234)));
    assert_eq!(session_receipt(valid.as_bytes(), "other"), None);
    for text in [
        valid.replace("windows:1234", "linux:1234"),
        valid.replace("windows:1234", "windows:abc"),
        valid.replace("windows:1234", "windows:18446744073709551616"),
        valid.replacen("42", "0", 1),
        valid.replacen("42", "4294967296", 1),
        valid.replace("\t0\t", "\t123\t"),
        valid.replace(r"C:\Coco\coco-companion.exe", "relative.exe"),
        valid.trim_end().into(),
        format!("{valid}{valid}"),
        valid.replace("\t12\t", "\tbad\t"),
    ] {
        assert_eq!(session_receipt(text.as_bytes(), "one"), None, "{text:?}");
    }
}

#[test]
fn leave_removes_registration_before_the_other_files() {
    let removed = RefCell::new(Vec::new());
    remove_session_files("registration", Some("marker"), Some("deadline"), |file| {
        removed.borrow_mut().push(file);
        true
    });
    assert_eq!(*removed.borrow(), ["registration", "marker", "deadline"]);
}

#[test]
fn failed_registration_removal_keeps_the_other_files() {
    let removed = RefCell::new(Vec::new());
    remove_session_files("registration", Some("marker"), Some("deadline"), |file| {
        removed.borrow_mut().push(file);
        false
    });
    assert_eq!(*removed.borrow(), ["registration"]);
}

#[test]
fn a_writer_arriving_after_leave_does_not_publish() {
    registered_write(
        || None::<u64>,
        || -> Result<(), ()> { panic!("late writer published") },
        |_| panic!("nothing to discard"),
    )
    .unwrap();
}

#[test]
fn every_leave_boundary_keeps_the_deadline_absent() {
    // Move the leave across every boundary of the real registered_write control flow.
    for boundary in 0..=3 {
        let registered = Cell::new(Some(1));
        let deadline = Cell::new(false);
        let reads = Cell::new(0);
        if boundary == 0 {
            registered.set(None);
        }
        registered_write(
            || {
                reads.set(reads.get() + 1);
                if reads.get() == 2 && boundary == 2 {
                    registered.set(None);
                    deadline.set(false);
                }
                registered.get()
            },
            || -> Result<(), ()> {
                if boundary == 1 {
                    registered.set(None);
                    deadline.set(false);
                }
                deadline.set(true);
                Ok(())
            },
            |_| deadline.set(false),
        )
        .unwrap();
        if boundary == 3 {
            registered.set(None);
            deadline.set(false);
        }
        assert!(!deadline.get(), "leave boundary {boundary} resurrected the deadline");
    }
}

#[test]
fn live_registration_keeps_its_deadline() {
    let published = Cell::new(false);
    registered_write(
        || Some(1),
        || -> Result<(), ()> {
            published.set(true);
            Ok(())
        },
        |_| panic!("live deadline discarded"),
    )
    .unwrap();
    assert!(published.get());
}

#[test]
fn a_replaced_registration_discards_only_the_writers_file() {
    let registration = Cell::new(1);
    let discarded = Cell::new(None);
    registered_write(
        || Some(registration.get()),
        || -> Result<u64, ()> {
            registration.set(2);
            Ok(71)
        },
        |file| discarded.set(Some(file)),
    )
    .unwrap();
    assert_eq!(registration.get(), 2);
    assert_eq!(discarded.get(), Some(71));
}

#[test]
fn a_failed_publish_does_not_remove_another_deadline() {
    let result = registered_write(
        || Some(1),
        || -> Result<(), &str> { Err("write failed") },
        |_| panic!("failed writer removed another file"),
    );
    assert_eq!(result, Err("write failed"));
}
