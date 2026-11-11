// Types for static image imports (`import photo from './x.jpg'`). Next generates the same reference in
// next-env.d.ts, but that file is git-ignored, so a fresh checkout (CI typecheck before build) lacks it.
/// <reference types="next/image-types/global" />
