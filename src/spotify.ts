import SpotifyWebApi from 'spotify-web-api-node';
import { getTokens, saveTokens, UserTokens } from './db';

// Required scopes to check currently playing status
export const SPOTIFY_SCOPES = ['user-read-currently-playing', 'user-read-playback-state'];

/**
 * Creates an unauthenticated Spotify client instance.
 */
export function createSpotifyClient(): SpotifyWebApi {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  });
}

/**
 * Generates the Spotify authorization URL for a user.
 * We pass the Telegram User ID in the `state` parameter to link accounts on redirect.
 */
export function getAuthorizationUrl(telegramId: string): string {
  const spotifyApi = createSpotifyClient();
  return spotifyApi.createAuthorizeURL(SPOTIFY_SCOPES, telegramId);
}

/**
 * Exchanges the authorization code for access and refresh tokens, and saves them.
 */
export async function handleAuthorizationCode(
  telegramId: string,
  telegramName: string,
  code: string
): Promise<void> {
  const spotifyApi = createSpotifyClient();
  const response = await spotifyApi.authorizationCodeGrant(code);

  const { access_token, refresh_token, expires_in } = response.body;
  const expiresAt = Date.now() + expires_in * 1000;

  await saveTokens(telegramId, {
    telegramName,
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt,
  });
}

/**
 * Retrieves a Spotify client configured and authenticated for the given Telegram user.
 * Automatically refreshes the token if it has expired or is about to expire (within 5 minutes).
 */
export async function getAuthenticatedSpotifyClient(telegramId: string): Promise<SpotifyWebApi | null> {
  const tokens = await getTokens(telegramId);
  if (!tokens) {
    return null;
  }

  const spotifyApi = createSpotifyClient();
  spotifyApi.setAccessToken(tokens.accessToken);
  spotifyApi.setRefreshToken(tokens.refreshToken);

  // If token is expired or expires in less than 5 minutes, refresh it
  const BufferMs = 5 * 60 * 1000;
  if (Date.now() + BufferMs >= tokens.expiresAt) {
    console.log(`Refreshing Spotify token for user ${tokens.telegramName} (${telegramId})...`);
    try {
      const data = await spotifyApi.refreshAccessToken();
      const newAccessToken = data.body.access_token;
      const newExpiresAt = Date.now() + data.body.expires_in * 1000;

      // Some authorization flows return a new refresh token, otherwise keep the old one
      const newRefreshToken = data.body.refresh_token || tokens.refreshToken;

      // Update in our JSON database
      await saveTokens(telegramId, {
        telegramName: tokens.telegramName,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
      });

      spotifyApi.setAccessToken(newAccessToken);
      spotifyApi.setRefreshToken(newRefreshToken);
      console.log(`Spotify token refreshed successfully for ${tokens.telegramName}.`);
    } catch (err) {
      console.error(`Failed to refresh Spotify token for user ${tokens.telegramName}:`, err);
      // In case of failure (e.g. revoked access), we can return null to prompt login again
      return null;
    }
  }

  return spotifyApi;
}

export interface PlaybackState {
  isPlaying: boolean;
  trackName: string;
  artists: string;
  spotifyUrl: string;
}

/**
 * Fetches the currently playing track details for a Telegram user.
 */
export async function getCurrentlyPlaying(telegramId: string): Promise<PlaybackState | null> {
  const spotifyApi = await getAuthenticatedSpotifyClient(telegramId);
  if (!spotifyApi) {
    return null;
  }

  try {
    const response = await spotifyApi.getMyCurrentPlayingTrack();
    const playback = response.body;

    if (!playback || !playback.item) {
      return { isPlaying: false, trackName: '', artists: '', spotifyUrl: '' };
    }

    // Extract item and check if it's a track (vs episode)
    const item = playback.item;
    if (item.type !== 'track') {
      return { isPlaying: false, trackName: '', artists: '', spotifyUrl: '' };
    }

    const trackName = item.name;
    const artists = item.artists.map((a: any) => a.name).join(', ');
    const spotifyUrl = item.external_urls.spotify;
    const isPlaying = playback.is_playing;

    return {
      isPlaying,
      trackName,
      artists,
      spotifyUrl,
    };
  } catch (err) {
    console.error(`Error fetching currently playing track for user ${telegramId}:`, err);
    throw err;
  }
}
