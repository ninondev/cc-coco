//! The event-only long-task notice gate; it has no OS dependencies or clock.
use std::collections::BTreeMap;
#[derive(Clone, Debug)]
pub struct Candidate {
    pub session: String,
    pub done: u64,
    pub busy_since: u64,
    pub enabled: bool,
    pub quiet: bool,
    pub waiting: bool,
}
#[derive(Default)]
pub struct NoticeGate {
    processed: BTreeMap<String, u64>,
    posted: BTreeMap<String, u64>,
}
impl NoticeGate {
    /// First sightings are a baseline, including files appearing after startup.
    pub fn observe(
        &mut self,
        candidate: &Candidate,
        now: u64,
        away: impl FnOnce() -> bool,
    ) -> bool {
        let Some(previous) = self.processed.get(&candidate.session).copied() else {
            self.processed
                .insert(candidate.session.clone(), candidate.done);
            return false;
        };
        if candidate.done <= previous || (!candidate.quiet && !candidate.waiting) {
            return false;
        }
        self.processed
            .insert(candidate.session.clone(), candidate.done);
        if !candidate.enabled
            || candidate.waiting
            || !candidate.quiet
            || candidate.busy_since == 0
            || candidate.done.saturating_sub(candidate.busy_since) < 120_000
            || self
                .posted
                .get(&candidate.session)
                .is_some_and(|posted| now.saturating_sub(*posted) < 600_000)
            || !away()
        {
            return false;
        }
        self.posted.insert(candidate.session.clone(), now);
        true
    }
}
