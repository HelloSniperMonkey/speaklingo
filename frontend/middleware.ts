import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import Negotiator from "negotiator";
import { match } from "@formatjs/intl-localematcher";
import { locales, defaultLocale, type Locale } from "@/lib/i18n";

const LOCALE_COOKIE = "NEXT_LOCALE";

function getLocaleFromRequest(request: NextRequest): Locale {
  // Check cookie first
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && locales.includes(cookieLocale as Locale)) {
    return cookieLocale as Locale;
  }

  // Parse Accept-Language header
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const negotiator = new Negotiator({ headers });
  const languages = negotiator.languages();

  try {
    return match(languages, locales as unknown as string[], defaultLocale) as Locale;
  } catch {
    return defaultLocale;
  }
}

function pathnameHasLocale(pathname: string): boolean {
  return locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip internal paths and API routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".") // Static files
  ) {
    return NextResponse.next();
  }

  // Check if pathname already has a locale
  if (pathnameHasLocale(pathname)) {
    return NextResponse.next();
  }

  // Redirect to locale-prefixed path
  const locale = getLocaleFromRequest(request);
  request.nextUrl.pathname = pathname === "/" ? `/${locale}/landing` : `/${locale}${pathname}`;

  const response = NextResponse.redirect(request.nextUrl);

  // Set locale cookie for future requests
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  return response;
}

export const config = {
  matcher: [
    // Skip internal paths
    "/((?!_next|api|.*\\..*).*)",
  ],
};
