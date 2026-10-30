/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Interface language chosen by src/middleware.ts. */
    locale: import('./shared/i18n.ts').Locale;
    /** Locale-neutral path of the page (`/zh-CN/topics` → `/topics`); views build links from it. */
    path: string;
  }
}
