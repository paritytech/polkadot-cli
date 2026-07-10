// Text imports (`import md from "…​.md" with { type: "text" }`) let us bundle the
// skill markdown into the binary. Bun inlines the file contents as a string at
// `bun build` time; this ambient declaration keeps `tsc --noEmit` happy without
// reading the file off disk.
declare module "*.md" {
  const content: string;
  export default content;
}
