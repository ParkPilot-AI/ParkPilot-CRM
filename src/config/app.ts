/**
 * Product identity. Change the name here and it changes everywhere.
 * ParkPilot CRM is the simple, mobile-first sales CRM for holiday park sales teams.
 */
export const APP_NAME = "ParkPilot CRM";
export const PRODUCT_NAME = "CRM";
export const PARENT_BRAND = "ParkPilot";
export const PARENT_URL = "https://www.parkpilot.uk";
export const APP_TAGLINE = "Simple to use. Built for holiday park sales.";
export const APP_DESCRIPTION =
  "ParkPilot CRM is a simple, mobile-first sales CRM for holiday park sales teams: leads added automatically, a clear daily task list and park tours in your calendar.";
export const CONTACT_EMAIL = "info@parkpilot.uk";
export const CONTACT_PHONE = "07907 992403";

/** ParkPilot palette (Brand Foundation) for places CSS variables can't reach. */
export const BRAND = {
  accent: "#E1140A",
  accentDark: "#B80F08",
  ink: "#111111",
  charcoal: "#26282B",
  mist: "#F4F4F5",
  silver: "#D4D4D8",
} as const;

/** Cookie holding the user's currently selected workspace (operator) id. */
export const WORKSPACE_COOKIE = "pp_crm_ws";
/** Cookie holding the user's currently selected park id. */
export const PARK_COOKIE = "pp_crm_park";
