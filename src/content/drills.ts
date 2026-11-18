import type { Drill } from './types';

export const DRILLS: readonly Drill[] = [
  { id: 'catch-up', name: 'Catch-up', cue: 'Lead hand waits out front until the other hand touches it, then pulls', focus: 'catch', finsRecommended: 'optional', difficulty: 1 },
  { id: 'fingertip-drag', name: 'Fingertip drag', cue: 'Drag fingertips along the surface on recovery to keep a high, relaxed elbow', focus: 'recovery', finsRecommended: 'optional', difficulty: 1 },
  { id: 'zipper', name: 'Zipper', cue: 'Thumb traces up the side of your body from hip to armpit', focus: 'recovery', finsRecommended: 'optional', difficulty: 1 },
  { id: 'six-kick-switch', name: '6-kick switch (6-1-6)', cue: '6 kicks on your side, 1 stroke, 6 kicks on the other side. Rotate from the hips', focus: 'rotation', finsRecommended: 'yes', difficulty: 2 },
  { id: 'side-kick', name: 'Side kick', cue: 'On your side, lower arm extended, face down, roll to breathe', focus: 'kick', finsRecommended: 'yes', difficulty: 1 },
  { id: 'single-arm-forward', name: 'Single-arm (other arm forward)', cue: 'One arm swims while the other stays extended. Breathe toward the working arm', focus: 'rotation', finsRecommended: 'yes', difficulty: 2 },
  { id: 'single-arm-side', name: 'Single-arm (other arm at side)', cue: 'Harder: tests rotation and timing', focus: 'rotation', finsRecommended: 'yes', difficulty: 3 },
  { id: 'fist-drill', name: 'Fist drill', cue: 'Swim with closed fists so the forearm has to catch the water', focus: 'catch', finsRecommended: 'no', difficulty: 2 },
  { id: 'front-scull', name: 'Front scull', cue: 'Arms forward, small in/out sweeps, press water back', focus: 'feel', finsRecommended: 'yes', difficulty: 2 },
  { id: 'mid-scull', name: 'Mid scull', cue: 'Hands under your chest. Feel the pressure on your forearms', focus: 'feel', finsRecommended: 'yes', difficulty: 2 },
  { id: 'vertical-kick', name: 'Vertical kick', cue: 'Upright in deep water, arms crossed, flutter kick from the hips, head up', focus: 'kick', finsRecommended: 'no', difficulty: 3 },
  { id: 'streamline-kick', name: 'Streamline kick', cue: 'Arms locked overhead, biceps against ears, short fast kicks', focus: 'kick', finsRecommended: 'optional', difficulty: 1 },
  { id: 'tarzan', name: 'Tarzan / head-up free', cue: 'Eyes forward and head out: builds a strong catch and sighting', focus: 'catch', finsRecommended: 'no', difficulty: 2 },
  { id: 'shark-fin', name: 'Shark fin / touch-and-go', cue: 'Touch your armpit on recovery, then reach forward', focus: 'recovery', finsRecommended: 'optional', difficulty: 1 },
  { id: 'three-three-three', name: '3-3-3 (3 R, 3 L, 3 full)', cue: 'Alternate single-arm strokes and full strokes. Keep the stroke even', focus: 'rotation', finsRecommended: 'yes', difficulty: 3 },
  { id: 'bilateral-breathing', name: 'Bilateral breathing (B3/B5)', cue: 'Breathe every 3 or 5 strokes to even out the stroke', focus: 'breathing', finsRecommended: 'no', difficulty: 2 },
  { id: 'doggy-paddle', name: 'Doggy paddle / underwater recovery', cue: 'Full catch-and-pull under the body with the recovery underwater', focus: 'catch', finsRecommended: 'yes', difficulty: 1 },
  { id: 'kick-on-back', name: 'Kick on back', cue: 'Hips up, kick from the hips, ankles loose. Kinder to the neck than a kickboard', focus: 'kick', finsRecommended: 'optional', difficulty: 1 },
  { id: 'count-strokes', name: 'Count strokes (DPS)', cue: 'Count strokes per length and try to take one fewer', focus: 'feel', finsRecommended: 'no', difficulty: 2 },
  { id: 'build-25s', name: 'Polo / build 25s', cue: 'Build speed through each 25 while keeping the stroke long', focus: 'feel', finsRecommended: 'no', difficulty: 3 },
];
