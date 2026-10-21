import Foundation

enum D1Pill {
    static func task(_ record:Record,now:Double,pixel:Bool,reduced:Bool)->String? {
        if record.shed?.frame(at:now,pixel:pixel,reduced:reduced) != nil,!record.shedAside.isEmpty {return record.shedAside}
        guard !record.rest, let task = record.task else { return nil }
        // While a task list runs the pill ends with where it is («task 3/7»), after the language's comma.
        guard let place = record.place else { return task }
        return task + Clauses.separator(record.lang) + place
    }
}
