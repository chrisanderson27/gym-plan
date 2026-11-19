// Structural mirrors of content/types.ts. The eslint fence forbids importing content.
export interface GymZoneShape { id: string; floor: number; neighbours: string[] }
export interface GymItemShape {
  id: string;
  floor: number;
  zone: string;
  type: string;
  count: number;
  confidence: 'C' | 'L' | 'G';
  exercises: string[];
  verified: boolean;
  pending?: true;
}
export interface GymPodShape { id: string; zone: string; items: string[] }
export interface GymProfileShape {
  id: 'home-gym';
  zones: GymZoneShape[];
  items: GymItemShape[];
  pods: GymPodShape[];
}
