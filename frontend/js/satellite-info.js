/**
 * Text shown in the satellite info window (js/satellite-panel.js). Edit wording here.
 * Wording rules: plain language, "pixel spacing" (not "resolution"), NISAR is provisional and is never
 * compared with Sentinel-1 as a change.
 */
export const SAT_INFO = {
  s1: {
    name: 'Sentinel-1',
    accent: '#4cc9f0',
    accentRgb: '76, 201, 240',
    kicker: 'ESA · Copernicus programme',
    tagline: 'Europe’s radar eyes on Earth',
    about:
      'Sentinel-1 sends microwave pulses down to the ground and listens for the echo. Because it makes its own signal, it sees through clouds and works at night. Smooth, open water reflects the pulse away from the satellite, so lakes show up dark and are easy to outline.',
    facts: [
      ['Radar band', 'C-band (wavelength about 5.5 cm)'],
      ['Altitude', '693 km'],
      ['Orbit', 'Polar, sun-synchronous (98.18°)'],
      ['Repeat visit', 'Every 12 days per satellite'],
      ['Swath width', '250 km (interferometric wide mode)'],
      ['First launch', 'Sentinel-1A, April 2014'],
    ],
    role: 'Gives AQUA SAR the yearly record of Lake Burullus from 2019 to 2026: water, vegetation and land, mapped from VV and VH radar signals at 10 m pixel spacing.',
    note: '',
  },
  nisar: {
    name: 'NISAR',
    accent: '#f5c542',
    accentRgb: '245, 197, 66',
    kicker: 'NASA · ISRO',
    tagline: 'NASA–ISRO Synthetic Aperture Radar',
    about:
      'NISAR is a joint NASA and Indian Space Research Organisation radar satellite that watches how land, ice and water change. It carries two radars, L-band and S-band. The longer L-band wave interacts with plants differently from the C-band wave of Sentinel-1, so it adds a second view of the lake.',
    facts: [
      ['Radar bands', 'L-band (about 24 cm) and S-band'],
      ['Altitude', '747 km'],
      ['Orbit', 'Polar, sun-synchronous (98.4°)'],
      ['Repeat visit', 'Every 12 days'],
      ['Swath width', '242 km'],
      ['Launched', '30 July 2025, from India'],
    ],
    role: 'Adds the 2026 layer: L-band HH and HV radar over Lake Burullus, June to October 2026 (track 129).',
    note: 'NISAR data are provisional and cover one season, so we show them next to Sentinel-1 and never calculate a change between the two satellites.',
  },
};
