export type TexasVenueStatus =
  | 'listed'
  | 'call-first'
  | 'moving'
  | 'relocating'
  | 'opening-soon'
  | 'opening-tba'
  | 'planned-opening'
  | 'soft-open'
  | 'opened'
  | 'reopened'
  | 'operating'
  | 'status-check';

export type TexasVenue = {
  readonly id: string;
  readonly name: string;
  readonly city: TexasVenueCity;
  readonly status: TexasVenueStatus;
  readonly note: string | null;
};

type TexasVenueSource = Omit<TexasVenue, 'id'>;

const getStableVenueId = (name: string, city: string) => `${name}-${city}`
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’']/g, '')
  .replace(/&/g, ' and ')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const defineVenue = ({ name, city, status, note }: TexasVenueSource): TexasVenue => ({
  id: getStableVenueId(name, city),
  name,
  city,
  status,
  note
});

// "listed" means only that the venue appears in the supplied source list. It is
// not an assertion that the venue is currently open or independently verified.
export const texasVenues: readonly TexasVenue[] = [
  defineVenue({ name: '101 Poker Club', city: 'Katy', status: 'listed', note: '21+' }),
  defineVenue({ name: '20to1 Social Club', city: 'Garland', status: 'listed', note: null }),
  defineVenue({ name: '3rd Coast Social Club', city: 'Port Lavaca', status: 'listed', note: null }),
  defineVenue({ name: '4 Suits Social Club', city: 'Humble', status: 'call-first', note: '21+; call first' }),
  defineVenue({ name: '409 Poker', city: 'Beaumont', status: 'listed', note: 'age unverified' }),
  defineVenue({ name: '52 Pick Up Social', city: 'Caddo Mills', status: 'listed', note: null }),
  defineVenue({ name: '9 Dragons Social Club', city: 'Houston', status: 'listed', note: null }),
  defineVenue({ name: 'Ace 1 Social Club', city: 'Corpus Christi', status: 'listed', note: null }),
  defineVenue({ name: 'Ace Card Club', city: 'San Antonio', status: 'listed', note: null }),
  defineVenue({ name: 'Ace High Social', city: 'Burleson', status: 'listed', note: null }),
  defineVenue({ name: 'Aces & Arrows Poker Room', city: 'Killeen', status: 'listed', note: 'age unverified' }),
  defineVenue({ name: 'Aces Full', city: 'Lufkin', status: 'listed', note: null }),
  defineVenue({ name: 'Aces Social Club', city: 'Port Lavaca', status: 'listed', note: null }),
  defineVenue({ name: 'Aggieland Poker Club', city: 'College Station', status: 'listed', note: null }),
  defineVenue({ name: 'Alamo Card House 2', city: 'San Antonio', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Alpha Social Card Club', city: 'Wichita Falls', status: 'listed', note: null }),
  defineVenue({ name: 'Amarillo Social Club', city: 'Amarillo', status: 'moving', note: 'moving September 1; call first' }),
  defineVenue({ name: 'Basin Poker Club', city: 'Midland', status: 'listed', note: '21+' }),
  defineVenue({ name: 'The Big Blind', city: 'San Antonio', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Bluefelt El Paso Card Club', city: 'El Paso', status: 'listed', note: null }),
  defineVenue({ name: 'Bluff RGV', city: 'Mission', status: 'listed', note: null }),
  defineVenue({ name: 'Broadway Social Club', city: 'Richmond', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Bullets Card Club', city: 'Austin', status: 'listed', note: null }),
  defineVenue({ name: 'Capri Poker Room', city: 'Webster', status: 'listed', note: '21+' }),
  defineVenue({ name: 'CBET Poker Room', city: 'Houston', status: 'opening-soon', note: '21+; opening soon' }),
  defineVenue({ name: 'Celebrity Card Club Odessa', city: 'Odessa', status: 'listed', note: null }),
  defineVenue({ name: 'Champions Club', city: 'Houston', status: 'listed', note: null }),
  defineVenue({ name: 'Champions Social Club Dallas', city: 'Dallas', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Clifton Card House', city: 'Bacliff', status: 'listed', note: '21+' }),
  defineVenue({ name: 'The Club EPTX / The Club Poker House', city: 'El Paso', status: 'listed', note: null }),
  defineVenue({ name: 'Comal Card Haus', city: 'New Braunfels', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Crossroads Card House', city: 'Victoria', status: 'listed', note: null }),
  defineVenue({ name: 'Cypress Poker Club', city: 'Cypress', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'The Desperado Club', city: 'Fort Worth', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'Deuces Wild Poker Club', city: 'Huntsville', status: 'listed', note: null }),
  defineVenue({ name: 'Doghouse Poker Club', city: 'Cypress', status: 'listed', note: null }),
  defineVenue({ name: 'Elite Poker Lounge Brownsville', city: 'Brownsville', status: 'listed', note: null }),
  defineVenue({ name: 'Elite Poker Lounge McAllen', city: 'McAllen', status: 'listed', note: null }),
  defineVenue({ name: 'Empire Poker Club', city: 'Houston', status: 'listed', note: '21+' }),
  defineVenue({ name: 'The Fort Card Room', city: 'Aledo', status: 'call-first', note: 'age-policy conflict; call first' }),
  defineVenue({ name: 'Fortune Poker Club', city: 'Houston', status: 'opening-soon', note: 'opening soon; call first' }),
  defineVenue({ name: 'Four Kings Card Club', city: 'Laredo', status: 'call-first', note: '21+; call first' }),
  defineVenue({ name: 'Game On Social Poker Club', city: 'College Station', status: 'listed', note: null }),
  defineVenue({ name: 'Georgetown Poker Club', city: 'Georgetown', status: 'listed', note: 'age unverified' }),
  defineVenue({ name: 'Gin Mill Card Club Farwell', city: 'Farwell', status: 'listed', note: null }),
  defineVenue({ name: 'Gin Mill Card Club Lubbock', city: 'Lubbock', status: 'listed', note: null }),
  defineVenue({ name: 'H-Town Card House', city: 'Spring', status: 'relocating', note: 'relocating; call first' }),
  defineVenue({ name: 'The Hangar Poker House', city: 'Humble', status: 'listed', note: '21+' }),
  defineVenue({ name: 'The Hideaway Poker Club', city: 'Carrollton', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'House of Cards Poker Club', city: 'Beaumont', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'House of Kings Card Club', city: 'El Paso', status: 'listed', note: null }),
  defineVenue({ name: 'Houston Social Cardroom', city: 'Houston', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Johny’s Social Card Club', city: 'Wichita Falls', status: 'listed', note: null }),
  defineVenue({ name: 'Jokers of Aggieland Poker Club', city: 'College Station', status: 'listed', note: null }),
  defineVenue({ name: 'JokerStars Social Club', city: 'Houston', status: 'listed', note: null }),
  defineVenue({ name: 'Just Jacks Social Club', city: 'Killeen', status: 'listed', note: null }),
  defineVenue({ name: 'The Kard Klub', city: 'Waco', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'Katy Poker', city: 'Katy', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Kensho Social Club', city: 'Belton', status: 'listed', note: 'nontraditional poker venue; age unverified' }),
  defineVenue({ name: 'Kickapoo Lucky Eagle Casino poker room', city: 'Eagle Pass', status: 'listed', note: '21+; casino' }),
  defineVenue({ name: 'KoJack’s Poker Club', city: 'Midland', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Laredo Poker Club', city: 'Laredo', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'Let’s Run It Social Club', city: 'Corpus Christi', status: 'listed', note: null }),
  defineVenue({ name: 'Lodge Card Club Austin', city: 'Round Rock', status: 'listed', note: null }),
  defineVenue({ name: 'Lodge Card Club San Antonio', city: 'San Antonio', status: 'listed', note: null }),
  defineVenue({ name: 'Lone Star Social', city: 'Cedar Park', status: 'listed', note: null }),
  defineVenue({ name: 'Lucky Aces Social Club', city: 'Houston', status: 'listed', note: null }),
  defineVenue({ name: 'Lucky Cat Social Card Club', city: 'Killeen', status: 'listed', note: null }),
  defineVenue({ name: 'Lucky J Social Club', city: 'Houston', status: 'reopened', note: '21+; reopened August 14' }),
  defineVenue({ name: 'Lucky Lodge Card House', city: 'Bryan', status: 'listed', note: null }),
  defineVenue({ name: 'Matador Poker House', city: 'Lubbock', status: 'listed', note: null }),
  defineVenue({ name: 'Mineral Wells Social Lounge', city: 'Mineral Wells', status: 'soft-open', note: 'soft-open; call first' }),
  defineVenue({ name: 'Monte Carlo Poker Social Club', city: 'Austin', status: 'listed', note: '21+' }),
  defineVenue({ name: 'NY Poker Club', city: 'Katy', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Oak Cliff Card Club', city: 'Dallas', status: 'listed', note: null }),
  defineVenue({ name: 'The Office Card House', city: 'San Antonio', status: 'listed', note: null }),
  defineVenue({ name: 'Palace Poker', city: 'Grand Prairie', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Paramount Social Club', city: 'Houston', status: 'listed', note: null }),
  defineVenue({ name: 'PH Social Club Dallas', city: 'Dallas', status: 'listed', note: null }),
  defineVenue({ name: 'Player’s Club', city: 'Beeville', status: 'listed', note: null }),
  defineVenue({ name: 'Poker 1', city: 'Odessa', status: 'listed', note: null }),
  defineVenue({ name: 'Poker House Fort Worth', city: 'Burleson', status: 'listed', note: null }),
  defineVenue({ name: 'Poker Knights Card House', city: 'Corpus Christi', status: 'listed', note: null }),
  defineVenue({ name: 'Premier Social Club', city: 'Victoria', status: 'listed', note: null }),
  defineVenue({ name: 'Prime Social', city: 'Houston', status: 'call-first', note: 'age-policy conflict; call first' }),
  defineVenue({ name: 'PrymeTyme Poker House', city: 'Canton', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'Pure Luck Social Poker Club', city: 'Killeen', status: 'opened', note: 'opened August 15' }),
  defineVenue({ name: 'Red Star Card Room', city: 'Austin', status: 'listed', note: null }),
  defineVenue({ name: 'Rio Raton Card Room', city: 'Alpine', status: 'listed', note: null }),
  defineVenue({ name: 'The River League', city: 'San Angelo', status: 'listed', note: null }),
  defineVenue({ name: 'The River Poker Club', city: 'Spring', status: 'listed', note: '21+' }),
  defineVenue({ name: 'River Rats Poker Club', city: 'Navasota', status: 'listed', note: null }),
  defineVenue({ name: 'The Rock Social Lounge', city: 'Round Rock', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'The Rose Social Club', city: 'Wilmer', status: 'status-check', note: '21+; soft-opening/status check' }),
  defineVenue({ name: 'Rounders Poker & Casino Club', city: 'Pharr', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'The Royal Card Club', city: 'Brownwood', status: 'listed', note: null }),
  defineVenue({ name: 'The Royal Card House of San Antonio', city: 'San Antonio', status: 'operating', note: '21+; operating in Chapter 11' }),
  defineVenue({ name: 'Royal Flush Social Club', city: 'Brownsville', status: 'listed', note: null }),
  defineVenue({ name: 'Royalz Poker Club', city: 'Edinburg', status: 'listed', note: null }),
  defineVenue({ name: 'Rustlers Poker Club', city: 'San Antonio', status: 'listed', note: '21+' }),
  defineVenue({ name: 'SA Card House', city: 'San Antonio', status: 'listed', note: '21+' }),
  defineVenue({ name: 'San Marcos Social Club', city: 'San Marcos', status: 'listed', note: null }),
  defineVenue({ name: 'Showdown Social Club', city: 'Sherman', status: 'planned-opening', note: 'planned Fall 2026 opening' }),
  defineVenue({ name: 'Shuffle 214', city: 'Dallas', status: 'listed', note: null }),
  defineVenue({ name: 'Shuffle 512', city: 'Austin', status: 'listed', note: null }),
  defineVenue({ name: 'South Plains Social Club', city: 'Farwell', status: 'listed', note: null }),
  defineVenue({ name: 'Spades Poker House Baytown', city: 'Baytown', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Spades Poker House', city: 'Webster', status: 'listed', note: null }),
  defineVenue({ name: 'The Speakeasy Card Room 2', city: 'Stephenville', status: 'opening-tba', note: '21+; opening TBA' }),
  defineVenue({ name: 'The Speakeasy Card Room', city: 'Gordon', status: 'listed', note: '19+' }),
  defineVenue({ name: 'Speaking Rock Entertainment', city: 'El Paso', status: 'listed', note: '21+; tribal/digital poker' }),
  defineVenue({ name: 'Sportsbook Bishop Arts', city: 'Dallas', status: 'listed', note: '21+; poker bar' }),
  defineVenue({ name: 'Sterling Social / Empire Poker Club Katy', city: 'Katy', status: 'status-check', note: '21+; branding/status check' }),
  defineVenue({ name: 'Suits Social Club', city: 'Brownsville', status: 'listed', note: null }),
  defineVenue({ name: 'Sun City Card Club', city: 'El Paso', status: 'listed', note: null }),
  defineVenue({ name: 'Supreme Social Club', city: 'Round Rock', status: 'listed', note: '21+' }),
  defineVenue({ name: 'TCH Social Austin', city: 'Austin', status: 'listed', note: null }),
  defineVenue({ name: 'TCH Social Las Colinas', city: 'Irving', status: 'listed', note: null }),
  defineVenue({ name: 'Texan Card Club', city: 'Stephenville', status: 'reopened', note: 'soft-reopened August 15; call first' }),
  defineVenue({ name: 'Texas Card House Dallas', city: 'Dallas', status: 'listed', note: null }),
  defineVenue({ name: 'Texas Card House Houston', city: 'Houston', status: 'listed', note: null }),
  defineVenue({ name: 'Texas Card House Rio Grande Valley', city: 'Edinburg', status: 'listed', note: null }),
  defineVenue({ name: 'Texas Card House Spring', city: 'Spring', status: 'listed', note: null }),
  defineVenue({ name: 'Texas Double Deuce Social Club', city: 'Burleson', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'Texline Card House', city: 'Texarkana', status: 'listed', note: null }),
  defineVenue({ name: 'Tilted Donkey Card Room', city: 'Marble Falls', status: 'call-first', note: 'call first' }),
  defineVenue({ name: 'VIP Social Club', city: 'Amarillo', status: 'listed', note: null }),
  defineVenue({ name: 'The War Room', city: 'Odessa', status: 'listed', note: null }),
  defineVenue({ name: 'West Texas Card House', city: 'Lubbock', status: 'listed', note: null }),
  defineVenue({ name: 'The Wheel Social Club', city: 'Houston', status: 'listed', note: '21+' }),
  defineVenue({ name: 'The White Rabbit', city: 'San Antonio', status: 'listed', note: '21+' }),
  defineVenue({ name: 'Win Poker Social Club', city: 'San Antonio', status: 'listed', note: '21+' })
];
import type { TexasVenueCity } from './texasMapGeometry';
