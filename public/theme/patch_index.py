#!/usr/bin/env python3
"""chaos-oss · index.html patcher

Idempotently injects chaos-oss theme customizations into the
Vite-generated index.html. The original Vite chunk references (preloads,
legacy entry, polyfill) are preserved as-is.

Strategy: surgical string replacements. We never touch the runtime
preload block at the bottom of the file, so the JS chunks Vite emitted
will still load.

Exits non-zero on any error.
"""

import re
import sys
from pathlib import Path


def patch(index_path: Path, splash_path: Path) -> None:
    html = index_path.read_text(encoding="utf-8")
    splash_snippet = splash_path.read_text(encoding="utf-8")

    # Bail out if the file has already been themed. We look for our
    # generator meta, which is the most stable marker.
    if 'name="generator" content="chaos-oss"' in html:
        # Re-running is fine, but skip to keep things fast.
        # We still need to keep the splash up-to-date though.
        if splash_snippet in html:
            print("[chaos-theme] index.html already themed; no changes")
            return

    # 1) color-scheme: prefer dark first
    html = html.replace(
        '<meta name="color-scheme" content="light dark" >',
        '<meta name="color-scheme" content="dark light" >',
    )
    # Some older releases used "dark light" already; no-op in that case.
    html = re.sub(
        r'<meta name="color-scheme" content="[^"]*" >',
        lambda m: m.group(0) if m.group(0).endswith('content="dark light" >')
        else '<meta name="color-scheme" content="dark light" >',
        html,
        count=1,
    )

    # 2) generator meta → chaos-oss
    html = re.sub(
        r'<meta name="generator" content="[^"]*" >',
        '<meta name="generator" content="chaos-oss" >',
        html,
        count=1,
    )

    # 3) theme-color: dark by default, with light override.
    # Replace any existing theme-color line(s) with our two.
    html = re.sub(
        r'<meta name="theme-color" content="[^"]*"[^>]*>',
        '',
        html,
    )
    theme_color_block = (
        '<meta name="theme-color" content="#0a0a0a" >\n'
        '    <meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)" >'
    )
    # Insert immediately after the generator line.
    html = html.replace(
        '<meta name="generator" content="chaos-oss" >',
        '<meta name="generator" content="chaos-oss" >\n    ' + theme_color_block,
        1,
    )

    # 4) apple-mobile-web-app-title
    html = re.sub(
        r'<meta name="apple-mobile-web-app-title" content="[^"]*" >',
        '<meta name="apple-mobile-web-app-title" content="chaos-oss" >',
        html,
        count=1,
    )

    # 5) apple-touch-icon → local svg
    html = re.sub(
        r'<link rel="apple-touch-icon" href="[^"]*" >',
        '<link rel="apple-touch-icon" href="/chaos-assets/logo/apple-touch-icon.svg" >',
        html,
        count=1,
    )

    # 6) favicon links: drop the crossorigin-tagged OpenList ones,
    # inject chaos-oss favicon + font preloads + theme css.
    favicon_block = (
        '<link       rel="icon"\n'
        '      type="image/svg+xml"\n'
        '      href="/chaos-assets/logo/favicon.svg"\n'
        '    >\n'
        '    <link       rel="shortcut icon"\n'
        '      type="image/svg+xml"\n'
        '      href="/chaos-assets/logo/favicon.svg"\n'
        '    >\n'
        '    <link rel="preload" as="font" type="font/woff2" href="/chaos-assets/fonts/InterVariable.woff2" crossorigin="anonymous" >\n'
        '    <link rel="preload" as="font" type="font/woff2" href="/chaos-assets/fonts/JetBrainsMono-Regular.woff2" crossorigin="anonymous" >\n'
        '    <link rel="stylesheet" href="/chaos-assets/chaos-theme.css" >\n'
        '    <link rel="stylesheet" href="/chaos-assets/splash/splash.css" >'
    )
    # Replace the first existing <link rel="shortcut icon" ...> block.
    html = re.sub(
        r'<link\s+rel="shortcut icon"[^>]*>(?:\s*</link>)?',
        favicon_block,
        html,
        count=1,
        flags=re.DOTALL,
    )
    # If the dist didn't have a shortcut-icon link (some releases don't),
    # inject the favicon block right after the apple-touch-icon line.
    if 'rel="shortcut icon"' not in html:
        html = html.replace(
            '<link rel="apple-touch-icon" href="/chaos-assets/logo/apple-touch-icon.svg" >',
            '<link rel="apple-touch-icon" href="/chaos-assets/logo/apple-touch-icon.svg" >\n    ' + favicon_block,
            1,
        )

    # 7) title → chaos-oss
    html = re.sub(
        r'<title>[^<]*</title>',
        '<title>chaos-oss</title>',
        html,
        count=1,
    )

    # 8) splash div + dismiss script: insert right before <div id="root"></div>.
    if 'id="chaos-splash"' not in html:
        html = html.replace(
            '<div id="root"></div>',
            splash_snippet + '\n    <div id="root"></div>',
            1,
        )

    # 9) OPENLIST_CONFIG main_color hint for the SPA.
    html = re.sub(
        r'main_color:\s*[^,}]+,',
        'main_color: "#5b8def",',
        html,
        count=1,
    )

    index_path.write_text(html, encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: patch_index.py <index.html> <splash.html>", file=sys.stderr)
        return 2
    patch(Path(sys.argv[1]), Path(sys.argv[2]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
