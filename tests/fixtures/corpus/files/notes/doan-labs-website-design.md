# Doan Labs website — design references

Collecting what influenced the new doan-labs site. None of this is final; it is the mood board.

## The globe

The hero should have a slowly rotating wireframe globe with arcs between cities where our
contributors live (Ho Chi Minh City, Berlin, Toronto). References:

- Stripe's old "global payments" globe: arcs that ease in, dots that pulse once when they land.
- GitHub's homepage globe (2020 redesign): WebGL, low-poly, dark background, very restrained colour.
- The cobe library (tiny WebGL globe) is probably enough; three.js is overkill for one hero element.

Rule: the globe never competes with the text. 40% opacity, monochrome, and it pauses when
`prefers-reduced-motion` is set.

## Typography

- Editorial serif for headlines only (we bundle Instrument Serif in KeepAnything too — reuse it).
- System sans for body. No more than two weights.
- Big type, small screens: headline clamps between 40px and 88px.

## Colour

Near-black background `#0b0b0c`, warm off-white text `#f3efe6`, a single accent used for links
and the globe arcs. No gradients. No "AI purple".

## Layout ideas worth keeping

- Linear.app: dense but calm feature grid; every card has one sentence and one image.
- Vercel: the changelog page as a product surface.
- Read.cv: profile pages that feel like a printed CV.

## To do

- Prototype the globe with cobe and measure idle CPU (must be < 3% on an M1 Air).
- Ask Linh whether the arcs should follow real contributor locations or be decorative.
