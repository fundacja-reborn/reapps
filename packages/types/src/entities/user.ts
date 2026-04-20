export interface User {
  id: string;
  username: string;
  settings_encrypted?: string;
  master_key_salt?: string;
  auth_key_salt?: string;
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'pl';
  preferred_date_format: string;
  preferred_time_format: '12h' | '24h';
  notifications_enabled: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  created_at: string;
  updated_at: string;
  preferred_language?: string;
  preferred_date_format?: string;
}

export interface UserCredentials {
  id: string;
  refreshToken: string;
  encrypted_master_key: string;
  master_key_salt: string;
  user_profile: UserProfile;
}

export interface LoginApiResponse {
  user?: {
    encrypted_master_key?: string;
    master_key_salt?: string;
    encrypted_2fa_secret?: string;
  };
  data?: {
    id: string;
    username: string;
    created_at?: string;
    updated_at?: string;
    preferredLanguage?: string;
    preferred_language?: string;
    preferred_date_format?: string;
    is_2fa_enabled?: boolean;
  };
  refreshToken?: string;
  success?: boolean;
  twoFactorRequired?: boolean;
  userId?: string;
  message?: string;
}
