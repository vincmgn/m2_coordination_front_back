import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  GEO_MESSAGES, GeoError, POSITION_OPTIONS, clearGeocodeCache, formatDistance, geocode, geocodeKey,
  getPosition, nearbyParams, roundCoord, type GeoEnv,
} from './geo';

function fakeEnv(answer: {lat: number; lon: number; accuracy: number} | {code: number}, secure = true): GeoEnv & {calls: PositionOptions[]} {
  const calls: PositionOptions[] = [];
  return {
    secure,
    calls,
    geolocation: {
      getCurrentPosition(success, error, options) {
        calls.push(options!);
        if ('code' in answer) error!({code: answer.code} as GeolocationPositionError);
        else success({coords: {latitude: answer.lat, longitude: answer.lon, accuracy: answer.accuracy}} as GeolocationPosition);
      },
    },
  };
}

function geoplateforme(coordinates: [number, number], score: number, label: string) {
  return new Response(JSON.stringify({features: [{geometry: {type: 'Point', coordinates}, properties: {label, score, type: 'housenumber'}}]}), {status: 200});
}

describe('Position', () => {
  it('renvoie latitude, longitude et précision, avec les options du contrat', async () => {
    const env = fakeEnv({lat: 45.757597, lon: 4.831662, accuracy: 1200});
    await expect(getPosition(env)).resolves.toEqual({lat: 45.757597, lon: 4.831662, accuracyM: 1200});
    expect(env.calls).toEqual([POSITION_OPTIONS]);
    expect(POSITION_OPTIONS).toEqual({enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000});
  });

  it('traduit un refus de permission en message utile', async () => {
    const err = await getPosition(fakeEnv({code: 1})).catch(e => e);
    expect(err).toBeInstanceOf(GeoError);
    expect(err.reason).toBe('denied');
    expect(err.message).toBe(GEO_MESSAGES.denied);
  });

  it('distingue position introuvable (2) et délai dépassé (3)', async () => {
    await expect(getPosition(fakeEnv({code: 2}))).rejects.toMatchObject({reason: 'unavailable'});
    await expect(getPosition(fakeEnv({code: 3}))).rejects.toMatchObject({reason: 'timeout', message: GEO_MESSAGES.timeout});
  });

  it('refuse tout de suite hors contexte sécurisé, sans interroger le navigateur', async () => {
    const env = fakeEnv({lat: 45.75, lon: 4.83, accuracy: 10}, false);
    await expect(getPosition(env)).rejects.toMatchObject({reason: 'insecure'});
    expect(env.calls).toHaveLength(0);
    await expect(getPosition({secure: true})).rejects.toMatchObject({reason: 'unsupported'});
  });
});

describe('Paramètres', () => {
  it('arrondit à 3 décimales (environ 111 m)', () => {
    expect(roundCoord(45.757597)).toBe(45.758);
    expect(roundCoord(4.831662)).toBe(4.832);
    expect(roundCoord(-0.5774621)).toBe(-0.577);
  });

  it('envoie lat, lon, radiusKm, page et limit avec les noms du contrat, position arrondie', () => {
    const p = nearbyParams({lat: 45.757597, lon: 4.831662}, {feature: 'vo'});
    expect(Object.fromEntries(p)).toEqual({lat: '45.758', lon: '4.832', radiusKm: '5', page: '1', limit: '6', feature: 'vo'});
    expect(p.toString()).toBe('lat=45.758&lon=4.832&radiusKm=5&page=1&limit=6&feature=vo');
  });

  it('omet l\'équipement vide', () => {
    expect(nearbyParams({lat: 45.7576, lon: 4.8317}, {page: 2}).has('feature')).toBe(false);
  });
});

describe('Affichage', () => {
  it('affiche les mètres sous 1 km', () => {
    expect(formatDistance(0.2)).toBe('200 m');
    expect(formatDistance(0)).toBe('0 m');
  });

  it('affiche les kilomètres à la française au-delà', () => {
    expect(formatDistance(1)).toBe('1 km');
    expect(formatDistance(1.2)).toBe('1,2 km');
    expect(formatDistance(12.3)).toBe('12,3 km');
  });
});

describe('Géocodage', () => {
  beforeEach(() => clearGeocodeCache());

  it('lit coordinates dans l\'ordre GeoJSON [lon, lat] : 69002 tombe à Lyon, pas en Somalie', async () => {
    const fetchFn = vi.fn().mockResolvedValue(geoplateforme([4.835685, 45.763721], 0.72, '20 Rue de la République 69002 Lyon'));
    const place = await geocode('20 rue de la République Lyon', fetchFn);
    expect(place).toEqual({lat: 45.763721, lon: 4.835685, label: '20 Rue de la République 69002 Lyon', score: 0.72});
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://data.geopf.fr/geocodage/search');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('ne fait qu\'un appel pour deux saisies qui ne diffèrent que par les espaces et les majuscules', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => geoplateforme([4.844596, 45.763688], 0.97, '21 Cours Lafayette 69006 Lyon'));
    const a = await geocode('21 cours Lafayette 69006 Lyon', fetchFn);
    const b = await geocode('  21   COURS lafayette 69006   lyon ', fetchFn);
    expect(b).toEqual(a);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(geocodeKey('  21   COURS Lafayette ')).toBe('21 cours lafayette');
  });

  it('refuse un résultat sous le seuil de score, ou une réponse vide', async () => {
    const low = vi.fn().mockResolvedValue(geoplateforme([4.9, 45.6], 0.39, 'Rue de la Mairie, Meaux-la-Montagne'));
    await expect(geocode('Place de la Mairie 69130 Écully', low)).rejects.toMatchObject({reason: 'not-found'});
    const empty = vi.fn().mockResolvedValue(new Response(JSON.stringify({features: []}), {status: 200}));
    await expect(geocode('zzzzzz', empty)).rejects.toMatchObject({reason: 'not-found'});
  });

  it('traduit un 429 et une panne réseau en messages distincts, sans mettre l\'échec en cache', async () => {
    const busy = vi.fn().mockResolvedValue(new Response('', {status: 429}));
    await expect(geocode('69002', busy)).rejects.toMatchObject({reason: 'busy', message: GEO_MESSAGES.busy});
    const down = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(geocode('69002', down)).rejects.toMatchObject({reason: 'network'});
    const ok = vi.fn().mockResolvedValue(geoplateforme([4.8269, 45.7485], 0.75, '69002 Lyon'));
    await expect(geocode('69002', ok)).resolves.toMatchObject({lat: 45.7485, lon: 4.8269});
  });
});
