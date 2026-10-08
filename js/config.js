// Public by design: the anon key grants only what RLS allows.
// Local values from `supabase status`. Swap for the hosted project at deploy (M6).
export const SUPABASE_URL = "https://yoycnblzoyshzgblyrqg.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveWNuYmx6b3lzaHpnYmx5cnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwODkzMzMsImV4cCI6MjEwNjY2NTMzM30.JaD8g87jTqTMuE-UVRN8jnHJ2kV3OoP2YY93p2o4noI";
export const STEPS_TARGET = 10000;
// Papa asked for a flag when stool is counted more than this many times in a day.
export const STOOL_MAX = 2;
// A day is green when these are logged and every due dose is ticked. Weight and diet are optional.
// Insulin units shown until a first dose is saved; after that the last saved dose carries forward day to day.
export const INSULIN_DEFAULT = 16;
export const REQUIRED_METRICS = ['bp', 'sugar', 'steps'];
// Bump together with CACHE in sw.js on every deploy.
export const APP_VERSION = '28';
// Web Push public key (public by design). Empty until the server key pair is made at deploy (M6).
export const VAPID_PUBLIC_KEY = 'BBu63lmRBHlIBUxNmhzPFKX-a8eekBHWc_cfODptG6Tw41Va4QCXMO8n7hpf7mDfesmfzG9rjTuZDNBbO4uQ3c0';
