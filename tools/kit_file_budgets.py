"""Per-file engine CPU allowances derived from three measured serial runs."""
import math
import os
import statistics

# Filled from actual serial calibration receipts; no guessed measurements.
CPU_BASELINES = {
    'b1-band.test.tsx': [10.776152, 8.720882, 8.514508],
    'b1-redraw-race.test.tsx': [3.326176, 3.254031, 2.8334639999999998],
    'b1-startup.test.tsx': [1.613622, 1.548792, 1.334471],
    'b1-wake-settings.test.tsx': [5.134177, 4.097973, 3.272404],
    'b1b-book-settings-cache.test.tsx': [2.580706, 2.166635, 1.372789],
    'b1b-chain-api.test.tsx': [1.179562, 0.953076, 0.6101329999999999],
    'b1b-first-answer.test.tsx': [21.800028, 17.231421, 14.698685999999999],
    'b1b-line-inventory.test.tsx': [0.33047499999999996, 0.235927, 0.190526],
    'b1b-presence-first-answer.test.tsx': [6.046996, 5.063856, 3.904459],
    'b1b-presence-recovery.test.tsx': [2.5401819999999997, 2.0436509999999997, 1.4207800000000002],
    'b1b-reading-log.test.tsx': [1.410763, 1.0835299999999999, 0.819248],
    'b1b-timing.test.tsx': [3.903479, 2.923843, 2.413293],
    'b1b-working-race.test.tsx': [2.169167, 1.6700080000000002, 1.461799],
    'b1c-band-subscription.test.tsx': [10.868471, 7.4279209999999996, 6.198977],
    'b1c-config.test.tsx': [6.895868, 7.0874239999999995, 4.345376],
    'b1c-layout.test.tsx': [2.097928, 2.156103, 1.4032930000000001],
    'b1c-motion-events.test.tsx': [4.969487, 4.276477, 2.9683960000000003],
    'b1c-settings-migration.test.tsx': [4.629428, 4.696606, 2.8203569999999996],
    'b4-surface.test.tsx': [10.999594, 9.927144, 6.459498],
    'b4b-transcript.test.tsx': [10.444506, 10.046768, 7.319513],
    'b4c-book.test.tsx': [0.6886720000000001, 0.688327, 0.409296],
    'b4c-transcript.test.tsx': [23.705226000000003, 23.821793, 17.025171],
    'band-classes.test.tsx': [6.357602, 7.438418, 5.3608199999999995],
    'band-spacing.test.tsx': [6.663952999999999, 6.981614, 5.477485],
    'band.test.tsx': [5.414308, 5.739262, 4.075714],
    'book-bundle.test.tsx': [0.30630799999999997, 0.333261, 0.218839],
    'book-fewer-words.test.tsx': [4.3867069999999995, 4.849566, 3.500826],
    'book-remote.test.tsx': [5.187524, 5.628123, 4.044423],
    'book-review.test.tsx': [4.858857, 5.6482779999999995, 4.165743],
    'book-spacing.test.tsx': [7.821063, 8.386726, 6.459506],
    'book-state.test.tsx': [8.7699, 9.162823000000001, 8.052395],
    'book-words.test.tsx': [3.1761660000000003, 2.958498, 2.4006819999999998],
    'book.test.tsx': [11.591137, 11.219419, 9.321973],
    'c2-book.test.tsx': [2.725898, 2.642957, 2.0789269999999997],
    'c2-card-check.test.tsx': [5.265788, 5.115096, 4.474314],
    'c2-events.test.tsx': [12.143474, 11.900777, 10.842664999999998],
    'c2-runtime.test.tsx': [3.387259, 3.000594, 2.528078],
    'c3-contrast.test.tsx': [3.245362, 3.1535499999999996, 2.630984],
    'c3-events.test.tsx': [23.197312, 21.614244, 20.473157999999998],
    'c3-guardian-motion.test.tsx': [0.34546199999999994, 0.292657, 0.356815],
    'c3-heads.test.tsx': [6.612548, 5.906773, 6.170856],
    'c3-lifecycle.test.tsx': [5.145846000000001, 4.802108, 4.899513],
    'c3-motion.test.tsx': [0.495992, 0.456941, 0.414636],
    'c3-neighbours.test.tsx': [3.489521, 3.435022, 3.161552],
    'c3-pure.test.tsx': [0.296697, 0.24001299999999998, 0.26253299999999996],
    'c3-quota-visual.test.tsx': [0.311357, 0.267681, 0.28704399999999997],
    'c3-runtime.test.tsx': [0.5722079999999999, 0.509217, 0.615998],
    'c3-slot.test.tsx': [1.8597540000000001, 1.785775, 2.072515],
    'c3-theme-config.test.tsx': [6.115712, 5.747773, 6.234757],
    'cache-rate-c1.test.tsx': [0.257511, 0.218191, 0.22953800000000002],
    'card-c1.test.tsx': [0.5674779999999999, 0.562507, 0.529033],
    'card-lazy-c3.test.tsx': [0.705645, 0.6543979999999999, 0.737403],
    'channel-startup.test.tsx': [0.280937, 0.23621999999999999, 0.305666],
    'checkup-c1.test.tsx': [0.32144799999999996, 0.283709, 0.33875299999999997],
    'chinese-hearing.test.tsx': [1.060535, 0.956193, 1.060154],
    'companion-activity.test.tsx': [5.253402, 4.990168000000001, 5.41401],
    # 10-19: three serial runs on his Mac, load about 4 (was [23.03, 20.89, 21.10]; the full kit's run went to 30.5 against its budget of 30)
    'companion-book.test.tsx': [27.6824, 28.1914, 27.7653],
    'companion-channel.test.tsx': [6.006340999999999, 5.39504, 5.3981259999999995],
    'companion-cold.test.tsx': [2.551407, 2.3452, 2.254616],
    'companion-feed-b3.test.tsx': [2.970808, 2.69454, 2.757306],
    'companion-state-event.test.tsx': [0.284443, 0.233337, 0.23915599999999998],
    'companion-words.test.tsx': [0.5052989999999999, 0.45531099999999997, 0.448417],
    'companion.test.tsx': [2.5549749999999998, 2.181685, 2.210128],
    'desktop-safe.test.tsx': [2.331527, 1.895857, 2.113968],
    'desktop-sprite.test.tsx': [5.0183800000000005, 4.066267, 4.397851],
    'fit.test.tsx': [60.453489, 49.709714, 51.59613],
    'gauge.test.tsx': [6.448349, 5.285632, 5.517132999999999],
    'head-width.test.tsx': [0.581746, 0.438256, 0.38034599999999996],
    'hook-cpu-coverage.test.tsx': [2.126281, 1.72457, 1.673331],
    'hook-cpu-primitive.test.tsx': [1.05795, 0.8616699999999999, 0.8804219999999999],
    'hook-event-cpu-calibration.test.tsx': [0.285304, 0.218586, 0.234572],
    'hook-event-envelope.test.tsx': [1.2202639999999998, 0.998211, 0.916677],
    'hook-native-cpu-calibration.test.tsx': [1.056555, 0.872591, 0.75925],
    'icon-book.test.tsx': [10.883893, 8.962542, 8.412671],
    'language.test.tsx': [5.350146, 4.460997, 4.252829],
    'lines-lazy-c3.test.tsx': [0.43655999999999995, 0.32228199999999996, 0.32656199999999996],
    'localization.test.tsx': [0.487946, 0.34407499999999996, 0.374316],
    'luck.test.tsx': [4.402413999999999, 3.602712, 3.723535],
    'machine.test.tsx': [14.806529, 11.254299, 12.01211],
    'manners.test.tsx': [4.284849, 3.206206, 3.862275],
    'merge-companion-target.test.tsx': [2.8757449999999998, 2.045734, 2.266487],
    'motion-b1.test.tsx': [1.2431619999999999, 0.753548, 0.900042],
    'motion.test.tsx': [1.26841, 0.9694189999999999, 0.968177],
    'numbers-c1.test.tsx': [0.7971189999999999, 0.585212, 0.600845],
    'paths-helper.test.tsx': [0.314763, 0.223248, 0.22965199999999997],
    'paths.test.tsx': [0.49041899999999994, 0.379256, 0.359252],
    'pixel-door.test.tsx': [0.461354, 0.35478299999999996, 0.30857999999999997],
    'poke.test.tsx': [15.305710999999999, 11.744449000000001, 12.930248],
    'preference-diagnostics.test.tsx': [7.440459, 5.7035670000000005, 6.819446],
    'presence-band.test.tsx': [13.177693999999999, 10.605913000000001, 11.373309],
    'presence-deadline.test.tsx': [0.476054, 0.387847, 0.42239299999999996],
    'presence-touch.test.tsx': [0.5059549999999999, 0.40194599999999997, 0.438137],
    # 10-19: VS Code and the phone draw the painted band now, measured on his Mac under load 4 to 8
    'm1-integration.test.tsx': [30.5108, 30.5223, 28.7438],
    'presence-words.test.tsx': [0.400622, 0.302874, 0.327603],
    'presence.test.tsx': [0.618707, 0.48941, 0.487295],
    'promises-persistence.test.tsx': [2.783326, 2.308178, 2.520054],
    'promises-runtime.test.tsx': [11.734874, 9.179504999999999, 9.750462],
    'quota-round-b1.test.tsx': [0.6894859999999999, 0.5237499999999999, 0.586878],
    'reaction.test.tsx': [11.585305, 9.831684, 10.183078],
    'shared-files.test.tsx': [0.31842, 0.284454, 0.276127],
    # 10-19: three serial runs on his Mac (MAC-ROUND 3.9), load 2.6 to 4.7, 1712 tests each
    'startup.test.tsx': [679.897, 685.495, 692.899],
    'stress-round-a.test.tsx': [15.413205, 10.635369, 9.159327],
    'tool-mark.test.tsx': [3.401265, 2.329468, 2.261995],
    'turn-head.test.tsx': [14.353818, 11.153378, 9.888881],
    'w2-band-regressions.test.tsx': [20.873465, 17.912184, 15.947416],
    'w3-band-regressions.test.tsx': [12.102770999999999, 10.843468, 9.552912999999998],
    'w3-companion-stage.test.tsx': [0.727334, 0.6221789999999999, 0.5378649999999999],
    'w3-inferred-stage.test.tsx': [3.260862, 3.268497, 2.866114],
    'w3-spoken-stage.test.tsx': [15.577045, 14.141335, 13.134070000000001],
    'w3-stage-marks.test.tsx': [3.6793, 3.182817, 3.0532470000000003],
    'w3-stage-runtime.test.tsx': [7.136637, 6.224296, 5.289418],
    'warmth-discovery.test.tsx': [1.237683, 0.8575489999999999, 0.77354],
    'windows-roots.test.tsx': [2.126822, 1.569013, 1.4058190000000002],
    'work-size.test.tsx': [7.773765, 5.833854, 6.1196280000000005],
}
CALIBRATION_SOURCE_SNAPSHOT_SHA256 = '7c69db97e522332ad608ef810ed3f16ea357dda4f0f6a781aee03d8edd2a00ba'
CALIBRATION_SOURCE_RUNS = [{'path': 'tools/evidence/p1-part5/workers-1-run-1.json', 'sha256': '50f7936da22c5f17021a935be0ec2a73015d9cd857c83fdaac306dd492f95d46'}, {'path': 'tools/evidence/p1-part5/workers-1-run-2.json', 'sha256': '5a7e10874b9495f5aa0759bd58a376ad7a658c365e8755c4f3f50a7a6a06fbfb'}, {'path': 'tools/evidence/p1-part5/workers-1-run-3.json', 'sha256': 'c14d761311ec7cb9fc78e5b385b039c6ae81b07e59c2f305b7d66a3edd789f19'}]

FILE_CPU_FLOOR_SECONDS = 30
BASE_MARGIN_FACTOR = 1.25
SPREAD_MARGIN_MULTIPLIER = 2.0
CALIBRATION_CPU_CEILING_SECONDS = 900


def cpu_scale():
    # The budgets come from one Mac. A slower host sets COCO_CPU_SCALE; unset means 1. Up to 8: public CI runs at 6,
    # since startup's batches went over at 4 on a slow cloud machine in the 10-17 rehearsal.
    raw = os.environ.get('COCO_CPU_SCALE', '')
    if raw.strip() == '':
        return 1.0
    try:
        value = float(raw)
    except ValueError:
        raise ValueError('COCO_CPU_SCALE must be a number from 1 to 8, got ' + repr(raw))
    if not math.isfinite(value) or not 1 <= value <= 8:
        raise ValueError('COCO_CPU_SCALE must be a number from 1 to 8, got ' + repr(raw))
    return value


def budget_for(file):
    scale = cpu_scale()
    samples = CPU_BASELINES.get(str(file))
    if samples is None:
        return math.ceil(round(FILE_CPU_FLOOR_SECONDS * scale, 6))
    if len(samples) != 3 or any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in samples):
        raise ValueError('invalid measured CPU baseline for ' + str(file))
    median = statistics.median(samples)
    spread = max(samples) - min(samples)
    margin = max(BASE_MARGIN_FACTOR * median, median + SPREAD_MARGIN_MULTIPLIER * spread)
    return math.ceil(round(max(FILE_CPU_FLOOR_SECONDS, math.ceil(margin)) * scale, 6))


def unmeasured_files(inventory):
    return [str(file) for file in inventory if str(file) not in CPU_BASELINES]
