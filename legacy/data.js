/* games.directory globe — data layer
 * HQ, activity types, and real-world city coordinates ([lng, lat]).
 * Coordinates are accurate; the projection places them precisely on the sphere.
 */

window.GD = window.GD || {};

// games.directory HQ — London, UK
GD.HQ = { name: 'games.directory HQ', city: 'London', lnglat: [-0.1276, 51.5074] };

// Activity types. `color` is the live, user-editable beam colour.
GD.ACTIVITY_TYPES = [
  { id: 'trophy', label: 'Trophy', color: '#FFC93C', enabled: true, weight: 5 },
  { id: 'platinum', label: 'Platinum trophy', color: '#3DA5FF', enabled: true, weight: 1 },
  { id: 'newgame', label: 'New game', color: '#FF5252', enabled: true, weight: 3 },
  { id: 'friend', label: 'New friend', color: '#36D399', enabled: true, weight: 2 },
  { id: 'levelup', label: 'Level up', color: '#B98CFF', enabled: true, weight: 3 },
  { id: 'completed', label: 'Game completed', color: '#2DD4D4', enabled: true, weight: 0.7 },
];

// World cities used as activity origins ([lng, lat]).
GD.CITIES = [
  { name: 'Tokyo', lnglat: [139.69, 35.68] },
  { name: 'Seoul', lnglat: [126.99, 37.55] },
  { name: 'Beijing', lnglat: [116.4, 39.9] },
  { name: 'Shanghai', lnglat: [121.47, 31.23] },
  { name: 'Hong Kong', lnglat: [114.17, 22.32] },
  { name: 'Singapore', lnglat: [103.82, 1.35] },
  { name: 'Bangkok', lnglat: [100.5, 13.75] },
  { name: 'Jakarta', lnglat: [106.85, -6.21] },
  { name: 'Manila', lnglat: [120.98, 14.6] },
  { name: 'Kuala Lumpur', lnglat: [101.69, 3.14] },
  { name: 'Mumbai', lnglat: [72.88, 19.08] },
  { name: 'Delhi', lnglat: [77.21, 28.61] },
  { name: 'Dubai', lnglat: [55.27, 25.2] },
  { name: 'Riyadh', lnglat: [46.71, 24.71] },
  { name: 'Tel Aviv', lnglat: [34.78, 32.08] },
  { name: 'Istanbul', lnglat: [28.98, 41.01] },
  { name: 'Moscow', lnglat: [37.62, 55.75] },
  { name: 'Cairo', lnglat: [31.24, 30.04] },
  { name: 'Nairobi', lnglat: [36.82, -1.29] },
  { name: 'Lagos', lnglat: [3.38, 6.52] },
  { name: 'Johannesburg', lnglat: [28.05, -26.2] },
  { name: 'Cape Town', lnglat: [18.42, -33.92] },
  { name: 'Athens', lnglat: [23.73, 37.98] },
  { name: 'Rome', lnglat: [12.5, 41.9] },
  { name: 'Madrid', lnglat: [-3.7, 40.42] },
  { name: 'Lisbon', lnglat: [-9.14, 38.72] },
  { name: 'Paris', lnglat: [2.35, 48.86] },
  { name: 'Amsterdam', lnglat: [4.9, 52.37] },
  { name: 'Berlin', lnglat: [13.4, 52.52] },
  { name: 'Warsaw', lnglat: [21.01, 52.23] },
  { name: 'Stockholm', lnglat: [18.07, 59.33] },
  { name: 'Reykjavik', lnglat: [-21.94, 64.15] },
  { name: 'Dublin', lnglat: [-6.26, 53.35] },
  { name: 'New York', lnglat: [-74.01, 40.71] },
  { name: 'Boston', lnglat: [-71.06, 42.36] },
  { name: 'Miami', lnglat: [-80.19, 25.76] },
  { name: 'Chicago', lnglat: [-87.63, 41.88] },
  { name: 'Toronto', lnglat: [-79.38, 43.65] },
  { name: 'Vancouver', lnglat: [-123.12, 49.28] },
  { name: 'Seattle', lnglat: [-122.33, 47.61] },
  { name: 'San Francisco', lnglat: [-122.42, 37.77] },
  { name: 'Los Angeles', lnglat: [-118.24, 34.05] },
  { name: 'Mexico City', lnglat: [-99.13, 19.43] },
  { name: 'Bogotá', lnglat: [-74.07, 4.71] },
  { name: 'Lima', lnglat: [-77.04, -12.05] },
  { name: 'São Paulo', lnglat: [-46.63, -23.55] },
  { name: 'Rio de Janeiro', lnglat: [-43.17, -22.91] },
  { name: 'Buenos Aires', lnglat: [-58.38, -34.6] },
  { name: 'Sydney', lnglat: [151.21, -33.87] },
  { name: 'Melbourne', lnglat: [144.96, -37.81] },
  { name: 'Auckland', lnglat: [174.76, -36.85] },
];
