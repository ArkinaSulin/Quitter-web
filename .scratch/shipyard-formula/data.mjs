// Scratch data for the QuiVER shipyard formula hunt.
// Encoded 1:1 from the reference HTML (index (1).html).

// Column order: [capacity, hp, dt, targetArea, cargo, speed, maneuver, crew, hitable, onHit, cost]
// Armor rows carry a 12th element: AC.
export const components = {
  frame: {
    name: 'Frame',
    inputType: 'dropdown',
    options: ['Small', 'Medium', 'Large'],
    values: {
      Small: [60, 150, 0, 1, 0, 0, 0, 0, 'yes', 'HP Dmg', 6000],
      Medium: [90, 250, 0, 2, 0, 0, 0, 0, 'yes', 'HP Dmg', 12000],
      Large: [140, 370, 0, 3, 0, 0, 0, 0, 'yes', 'HP Dmg', 20000],
    },
  },
  armor: {
    name: 'Armor',
    inputType: 'dropdown',
    options: ['Wood', 'Plated', 'Metal', 'Ceramic', 'Stone'],
    values: {
      Wood: ['0%', '0%', 15, 0, 0, 0, 0, 0, 'no', '', '0%', 15],
      Plated: ['-15%', '10%', 15, 0, 0, 0, 0, 0, 'no', '', '50%', 17],
      Metal: ['-25%', '20%', 15, 0, 0, 0, 0, 0, 'no', '', '100%', 19],
      Ceramic: ['-10%', '50%', 15, 0, 0, 0, 0, 0, 'no', '', '75%', 13],
      Stone: ['-30%', '0%', 20, 0, 0, 0, 0, 0, 'no', '', '-20%', 17],
    },
  },
  helm: { name: 'Helm', inputType: 'number', values: [-3, 0, 0, 1, 0, 0, 0, 1, 'yes', 'Pilot check or lost control', 5000] },
  keel: { name: 'Keel', inputType: 'readonly', values: [0, 0, 0, 1, 0, 0, 0, 0, 'yes', '2x HP Dmg', 0] },
  sail: { name: 'Sail', inputType: 'number', values: [-1, -0.2, 0, 0.25, 0, 1, 0, 0.2, 'yes', 'Speed -1', 200] },
  rudder: { name: 'Rudder', inputType: 'number', values: [-4, 0, 0, 1, 0, 0, 1, 1, 'yes', 'Maneuver +1', 1000] },
  cargo: { name: 'Cargo Hold', inputType: 'number', values: [-5, 0, 0, 1, 5, 0, 0, 0, 'yes', 'HP Dmg', 100] },
  stdWeapon: { name: 'Std Weapon Mount', inputType: 'number', values: [-2, 0, 0, 1, 0, 0, 0, 1, 'yes', 'Weapon disabled, Dmg to crew using it', 300] },
  largeWeapon: { name: 'Large Weapon Mount', inputType: 'number', values: [-3, 0, 0, 1, 0, 0, 0, 1, 'yes', 'Weapon disabled, Dmg to crew using it', 800] },
  hullReinforcement: { name: 'Hull Reinforcement', inputType: 'number', values: [-0.5, 5, 0, 0, 0, 0, 0, 0, 'no', '', 100] },
  additionalCrew: { name: 'Additional Crew', inputType: 'number', values: [0, 0, 0, 0, 0, 0, 0, 1, 'no', '', 0] },
  special: {
    name: 'Special',
    inputType: 'dropdown',
    options: [
      '',
      'Enclosed design -20% Capacity',
      'Lightweight design +20 Capacity -30% HP, Spider Legs -20 Capacity',
      'Bombard mount -60 Capacity -150 HP',
      'Lightweight design +20% Capacity -30% HP',
      'Living treant +150 HP, -5 crew',
      'Planar travel device & Tentacles -50 Capacity',
      'Scorpion Claws -10 Capacity',
      'Ram -10 Capacity',
    ],
    values: {
      '': [0, 0, 0, 0, 0, 0, 0, 0, 'no', '', 0],
      'Enclosed design -20% Capacity': ['-20%', 0, 0, 0, 0, 0, 0, 0, 'no', '', '30%'],
      'Lightweight design +20 Capacity -30% HP, Spider Legs -20 Capacity': [0, '-30%', 0, 0, 0, 0, 0, 0, 'no', '', 0],
      'Bombard mount -60 Capacity -150 HP': [-60, -150, 5, 0, 0, 0, 0, 0, 'no', '', 60000],
      'Lightweight design +20% Capacity -30% HP': ['20%', '-30%', 0, 0, 0, 0, 0, 0, 'no', '', 0],
      'Living treant +150 HP, -5 crew': [0, 150, 0, 0, 0, 0, 0, -5, 'no', '', 0],
      'Planar travel device & Tentacles -50 Capacity': [-50, 0, 0, 0, 0, 0, 0, 0, 'no', '', 0],
      'Scorpion Claws -10 Capacity': [-10, 0, 0, 0, 0, 0, 0, 0, 'no', '', 5000],
      'Ram -10 Capacity': [-10, 0, 0, 0, 0, 0, 0, 0, 'no', '', 1000],
    },
  },
};

// Reference ships: frame, armor, component counts, special, preset stats.
export const referenceShips = {
  Bombard: {
    frame: 'Large', armor: 'Wood',
    components: { helm: 1, sail: 36, rudder: 3, cargo: 3, stdWeapon: 2, largeWeapon: 0, hullReinforcement: 18, additionalCrew: 0, special: 'Bombard mount -60 Capacity -150 HP' },
    preset: { hp: 300, damageThreshold: 20, speed: 4, maneuver: 4, crew: 13, cargo: 15, cost: 97900 },
  },
  Damselfly: {
    frame: 'Small', armor: 'Plated',
    components: { helm: 1, sail: 28, rudder: 2, cargo: 1, stdWeapon: 1, largeWeapon: 1, hullReinforcement: 17, additionalCrew: 0, special: 'Lightweight design +20% Capacity -30% HP' },
    preset: { hp: 200, damageThreshold: 15, speed: 7, maneuver: 1, crew: 10, cargo: 5, cost: 24500 },
  },
  'Fast Lamprey': {
    frame: 'Medium', armor: 'Wood',
    components: { helm: 1, sail: 36, rudder: 3, cargo: 1, stdWeapon: 4, largeWeapon: 1, hullReinforcement: 12, additionalCrew: 0, special: 'Ram -10 Capacity' },
    preset: { hp: 300, damageThreshold: 15, speed: 6, maneuver: 2, crew: 16, cargo: 5, cost: 31500 },
  },
  'Flying Fish': {
    frame: 'Medium', armor: 'Wood',
    components: { helm: 1, sail: 28, rudder: 3, cargo: 8, stdWeapon: 1, largeWeapon: 1, hullReinforcement: 1, additionalCrew: 0, special: '' },
    preset: { hp: 250, damageThreshold: 15, speed: 5, maneuver: 2, crew: 11, cargo: 40, cost: 27600 },
  },
  Hammerhead: {
    frame: 'Large', armor: 'Wood',
    components: { helm: 1, sail: 36, rudder: 5, cargo: 10, stdWeapon: 2, largeWeapon: 1, hullReinforcement: 28, additionalCrew: 0, special: 'Ram -10 Capacity' },
    preset: { hp: 500, damageThreshold: 15, speed: 4, maneuver: 3, crew: 16, cargo: 50, cost: 43400 },
  },
  Lamprey: {
    frame: 'Medium', armor: 'Wood',
    components: { helm: 1, sail: 28, rudder: 4, cargo: 1, stdWeapon: 4, largeWeapon: 1, hullReinforcement: 21, additionalCrew: 0, special: 'Ram -10 Capacity' },
    preset: { hp: 350, damageThreshold: 15, speed: 5, maneuver: 2, crew: 15, cargo: 5, cost: 31800 },
  },
  'Living Ship': {
    frame: 'Medium', armor: 'Wood',
    components: { helm: 1, sail: 21, rudder: 2, cargo: 10, stdWeapon: 2, largeWeapon: 2, hullReinforcement: 1, additionalCrew: 0, special: 'Living treant +150 HP, -5 crew' },
    preset: { hp: 400, damageThreshold: 15, speed: 4, maneuver: 3, crew: 6, cargo: 50, cost: 26500 },
  },
  Nautiloid: {
    frame: 'Large', armor: 'Wood',
    components: { helm: 1, sail: 36, rudder: 4, cargo: 3, stdWeapon: 3, largeWeapon: 3, hullReinforcement: 8, additionalCrew: 2, special: 'Planar travel device & Tentacles -50 Capacity' },
    preset: { hp: 400, damageThreshold: 15, speed: 4, maneuver: 3, crew: 20, cargo: 15, cost: 0 },
  },
  Nightspider: {
    frame: 'Large', armor: 'Plated',
    components: { helm: 1, sail: 28, rudder: 4, cargo: 10, stdWeapon: 2, largeWeapon: 3, hullReinforcement: 17, additionalCrew: 10, special: 'Lightweight design +20 Capacity -30% HP, Spider Legs -20 Capacity' },
    preset: { hp: 400, damageThreshold: 15, speed: 3, maneuver: 3, crew: 25, cargo: 50, cost: 0 },
  },
  'Scorpion Ship': {
    frame: 'Small', armor: 'Metal',
    components: { helm: 1, sail: 6, rudder: 1, cargo: 2, stdWeapon: 1, largeWeapon: 1, hullReinforcement: 14, additionalCrew: 7, special: 'Scorpion Claws -10 Capacity' },
    preset: { hp: 250, damageThreshold: 15, speed: 3, maneuver: 2, crew: 12, cargo: 10, cost: 26900 },
  },
  'Shrike Ship': {
    frame: 'Medium', armor: 'Wood',
    components: { helm: 1, sail: 45, rudder: 3, cargo: 4, stdWeapon: 1, largeWeapon: 2, hullReinforcement: 7, additionalCrew: 0, special: 'Lightweight design +20% Capacity -30% HP' },
    preset: { hp: 200, damageThreshold: 15, speed: 7, maneuver: 2, crew: 16, cargo: 20, cost: 32000 },
  },
  'Space Galleon': {
    frame: 'Large', armor: 'Wood',
    components: { helm: 1, sail: 28, rudder: 4, cargo: 17, stdWeapon: 2, largeWeapon: 1, hullReinforcement: 7, additionalCrew: 7, special: '' },
    preset: { hp: 400, damageThreshold: 15, speed: 3, maneuver: 3, crew: 20, cargo: 85, cost: 38400 },
  },
  'Squid Ship': {
    frame: 'Medium', armor: 'Wood',
    components: { helm: 1, sail: 15, rudder: 2, cargo: 10, stdWeapon: 2, largeWeapon: 1, hullReinforcement: 10, additionalCrew: 5, special: 'Ram -10 Capacity' },
    preset: { hp: 300, damageThreshold: 15, speed: 3, maneuver: 3, crew: 14, cargo: 50, cost: 26400 },
  },
  'Star Moth': {
    frame: 'Medium', armor: 'Ceramic',
    components: { helm: 1, sail: 28, rudder: 3, cargo: 6, stdWeapon: 2, largeWeapon: 1, hullReinforcement: 6, additionalCrew: 2, special: '' },
    preset: { hp: 400, damageThreshold: 15, speed: 5, maneuver: 2, crew: 14, cargo: 30, cost: 37200 },
  },
  'Turtle Ship': {
    frame: 'Large', armor: 'Metal',
    components: { helm: 1, sail: 21, rudder: 3, cargo: 6, stdWeapon: 3, largeWeapon: 0, hullReinforcement: 12, additionalCrew: 5, special: 'Enclosed design -20% Capacity' },
    preset: { hp: 500, damageThreshold: 15, speed: 2, maneuver: 4, crew: 16, cargo: 30, cost: 60200 },
  },
  'Tyrant Ship': {
    frame: 'Medium', armor: 'Stone',
    components: { helm: 1, sail: 21, rudder: 3, cargo: 4, stdWeapon: 0, largeWeapon: 0, hullReinforcement: 11, additionalCrew: 2, special: '' },
    preset: { hp: 300, damageThreshold: 20, speed: 4, maneuver: 2, crew: 10, cargo: 20, cost: 0 },
  },
  'Wasp Ship': {
    frame: 'Small', armor: 'Wood',
    components: { helm: 1, sail: 15, rudder: 2, cargo: 2, stdWeapon: 1, largeWeapon: 0, hullReinforcement: 1, additionalCrew: 0, special: '' },
    preset: { hp: 150, damageThreshold: 15, speed: 5, maneuver: 1, crew: 7, cargo: 10, cost: 16600 },
  },
};
