import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const aliases = {
  'air-bike': ['air bike intervals', 'air bike steady state'],
  'assisted-dip': ['assisted dip'],
  'assisted-pull-up': ['assisted pull-up'],
  'back-extension': ['machine back extension'],
  'back-squat': ['back squat'],
  'barbell-ohp': ['overhead press'],
  'barbell-row': ['barbell row'],
  'battle-ropes': ['battle rope slams', 'battle rope waves'],
  'bench-press': ['barbell bench press', 'rack bench press'],
  'bird-dog': ['bird dog'],
  'box-squat': ['box squat'],
  'bulgarian-split-squat': ['bulgarian split squat (rear foot on box)'],
  'cable-crunch': ['cable crunch', 'machine crunch'],
  'cable-curl': ['cable curl', 'machine biceps curl'],
  'cable-fly': ['cable chest fly', 'cable crossover'],
  'cable-pull-through': ['cable pull-through'],
  'cable-woodchop': ['cable woodchop'],
  'calf-raise': ['standing calf raise'],
  'chest-press-machine': ['machine chest press'],
  'chest-supported-row': ['chest-supported dumbbell row'],
  'conventional-deadlift': ['deadlift'],
  'curve-sprint': ['curve sprint intervals'],
  'db-bench': ['dumbbell bench press', 'dumbbell flat press'],
  'db-curl': ['dumbbell curl'],
  'dead-bug': ['dead bug'],
  'elliptical': ['elliptical'],
  'ez-curl': ['ez-bar curl'],
  'face-pull': ['face pull'],
  'farmer-carry': ['farmer carry'],
  'front-squat': ['front squat'],
  'goblet-squat': ['goblet squat'],
  'hanging-knee-raise': ["hanging knee raise (captain's chair)"],
  'hip-abduction': ['hip abduction'],
  'hip-adduction': ['hip adduction'],
  'hip-thrust': ['hip thrust (barbell)', 'hip thrust (bench-supported)', 'machine hip thrust'],
  'incline-db-bench': ['dumbbell incline press'],
  'kb-clean': ['kettlebell clean'],
  'kb-deadlift': ['kettlebell deadlift'],
  'kb-press': ['kettlebell press'],
  'kb-swing': ['kettlebell swing'],
  'landmine-press': ['landmine press'],
  'lat-pulldown': ['lat pulldown'],
  'lateral-raise': ['cable lateral raise', 'dumbbell lateral raise', 'machine lateral raise'],
  'leg-curl': ['leg curl', 'seated leg curl'],
  'leg-extension': ['leg extension'],
  'leg-press': ['leg press', 'machine leg press', 'single-leg leg press', 'single-leg machine leg press'],
  'med-ball-slam': ['med ball slam'],
  'one-arm-db-row': ['dumbbell row', 'one-arm dumbbell row'],
  'overhead-triceps-extension': ['machine triceps extension'],
  'pallof-press': ['pallof press'],
  'pec-deck': ['machine pec fly'],
  'plank': ['plank'],
  'pull-up': ['chin-up', 'pull-up'],
  'push-up': ['push-up'],
  'reverse-pec-deck': ['reverse pec deck'],
  'romanian-deadlift': ['dumbbell rdl', 'romanian deadlift'],
  'rower': ['row intervals', 'row steady state'],
  'sandbag-carry': ['sandbag carry'],
  'sandbag-clean': ['sandbag clean'],
  'sandbag-lunge': ['sandbag lunge'],
  'sandbag-squat': ['sandbag squat'],
  'seated-cable-row': ['machine seated row', 'seated cable row'],
  'seated-db-press': ['dumbbell shoulder press', 'seated dumbbell shoulder press'],
  'shoulder-press-machine': ['machine shoulder press'],
  'single-arm-pulldown': ['single-arm lat pulldown'],
  'ski-erg': ['ski erg intervals', 'ski erg steady state'],
  'skull-crusher': ['ez-bar skull crusher', 'skull crusher'],
  'sled-push': ['sled backward drag', 'sled drag', 'sled pull', 'sled push'],
  'stair-climber': ['stair climb'],
  'standing-cable-press': ['standing cable press'],
  'standing-cable-row': ['cable row', 'single-arm cable row'],
  'standing-hip-abduction': ['standing hip abduction'],
  'step-up': ['step-up'],
  'suspension-row': ['suspension row'],
  'trap-bar-deadlift': ['trap bar deadlift'],
  'treadmill': ['incline walk', 'treadmill intervals', 'treadmill run'],
  'triceps-pushdown': ['cable pushdown', 'triceps pushdown'],
  'walking-lunge': ['dumbbell lunge', 'walking lunge'],
  'wall-ball': ['wall ball'],
};

const unprogrammable = [
  'a-skip', 'aerobic step', 'assisted hamstring stretch', 'barbell curl', 'barbell front raise',
  'barbell lunge', 'bear crawl', 'belt squat', 'belt squat rdl', 'box jump', 'close-grip bench press',
  'curve tempo run', 'decline barbell bench press', 'dip', 'dumbbell preacher curl', 'dumbbell shrug',
  'ez-bar preacher curl', 'foam rolling', 'glute bridge', 'heavy bag rounds', 'hip mobility',
  'incline barbell bench press', 'landmine rotation', 'landmine row', 'landmine squat', 'leg press calf raise',
  'machine glute kickback', 'machine torso rotation', 'med ball chest pass', 'med ball rotational throw',
  'mobility flow', 'power clean', 'preacher curl', 'pull-up (if bar present)', 'rack pull',
  'recumbent stepper', 'shuttle run', 'stationary bike', 'suspension chest press', 'suspension fallout',
  'suspension hamstring curl', 'suspension pistol squat', 'turkish get-up', 'tyre drag',
  'tyre flip', 'tyre slam', 'upright row',
];

export const EXERCISE_ALIASES = Object.freeze(Object.fromEntries([
  ...Object.entries(aliases).flatMap(([id, phrases]) => phrases.map((phrase) => [phrase, id])),
  ...unprogrammable.map((phrase) => [phrase, null]),
]));

const isSlug = (value) => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const positiveInt = (value) => Number.isInteger(value) && value > 0;
const idsOf = (rows) => new Set(rows.map((row) => row.id));

export function buildProfile(doc) {
  if (doc?.gym_id !== 'home-gym') throw new Error('Expected gym_id home-gym');
  const pending = doc.pending ?? [];
  const unmapped = [];
  const zones = doc.zones.map(({ id, floor, neighbours }) => {
    if (!isSlug(id) || !positiveInt(floor) || !Array.isArray(neighbours) || !neighbours.every(isSlug)) {
      throw new Error('Malformed zone id, floor or neighbours');
    }
    return { id, floor, neighbours };
  });
  const zoneIds = idsOf(zones);
  for (const { id, neighbours } of zones) {
    if (!neighbours.every((zone) => zoneIds.has(zone))) throw new Error(`Unknown neighbour in zone ${id}`);
  }
  function itemOf({ id, floor, zone, type, count, confidence, exercises, verified_on_site }, isPending) {
    if (!isSlug(id) || !isSlug(type) || !positiveInt(floor) || !positiveInt(count) || !['C', 'L', 'G'].includes(confidence)) {
      throw new Error('Malformed item id, type, floor, count or confidence');
    }
    if (!zoneIds.has(zone)) throw new Error(`Unknown zone for item ${id}`);
    const mapped = new Set();
    for (const phrase of exercises ?? []) {
      if (typeof phrase !== 'string') throw new Error(`Malformed exercise for item ${id}`);
      const key = phrase.toLowerCase();
      if (!Object.hasOwn(EXERCISE_ALIASES, key)) {
        unmapped.push(`unmapped exercise: ${JSON.stringify(phrase)} (item ${id})`);
        continue;
      }
      const slug = EXERCISE_ALIASES[key];
      if (slug === null) continue;
      if (!isSlug(slug)) throw new Error(`Invalid mapped exercise for item ${id}`);
      mapped.add(slug);
    }
    return { id, floor, zone, type, count, confidence, exercises: [...mapped], verified: verified_on_site != null, ...(isPending && { pending: true }) };
  }
  const items = [
    ...doc.items.map((item) => itemOf(item, false)),
    ...pending.filter((item) => [item.floor, item.zone, item.type, item.count].every((value) => value != null))
      .map((item) => itemOf(item, true)),
  ];
  const catalogIds = idsOf([...doc.items, ...pending]);
  const itemIds = idsOf(items);
  const pods = doc.pods.map(({ id, zone, items }) => {
    if (!isSlug(id)) throw new Error('Malformed pod id');
    if (!zoneIds.has(zone)) throw new Error(`Unknown zone for pod ${id}`);
    if (!Array.isArray(items) || !items.every((item) => catalogIds.has(item))) throw new Error(`Unknown item for pod ${id}`);
    return { id, zone, items: items.filter((item) => itemIds.has(item)) };
  });
  return { profile: { id: 'home-gym', zones, items, pods }, unmapped };
}

export function renderModule(profile) {
  return `// GENERATED by scripts/gen-gym.mjs — do not edit.\nimport type { GymProfile } from '../types';\n\nexport const HOME_GYM: GymProfile = ${JSON.stringify(profile, null, 2)};\n`;
}

function main() {
  const [catalog, flag, output, ...extra] = process.argv.slice(2);
  if (!catalog || (flag !== undefined && (flag !== '--out' || !output)) || extra.length) {
    throw new Error('Usage: gen-gym.mjs <catalog.yaml> [--out <home-gym.ts>]');
  }
  let doc;
  try {
    doc = parse(readFileSync(catalog, 'utf8'));
  } catch {
    throw new Error('Could not read or parse catalog');
  }
  const { profile, unmapped } = buildProfile(doc);
  const out = output ?? 'src/content/gym/home-gym.ts';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderModule(profile));
  for (const line of unmapped) console.error(line);
  console.log(`wrote ${profile.items.length} items, ${profile.pods.length} pods, ${profile.zones.length} zones`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not generate gym profile');
    process.exitCode = 1;
  }
}
