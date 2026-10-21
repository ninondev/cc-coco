export function contrastMedia(light: string, dark = light): string {
  return `@media(prefers-contrast:more),(forced-colors:active){${light}}@media(prefers-contrast:more) and (prefers-color-scheme:dark),(forced-colors:active) and (prefers-color-scheme:dark){${dark}}`
}
export function pictureColors(source: string): string {
  return source.replace(/<svg\b[^>]*>/, root => {
    const style = /\bstyle="([^"]*)"/.exec(root)
    if (style) {
      const value = style[1] ?? ''
      if (/\bforced-color-adjust\s*:\s*none(?:\s*;|\s*$)/.test(value)) return root
      return root.replace(style[0]!, `style="${value.replace(/;?\s*$/, ';')}forced-color-adjust:none"`)
    }
    return root.replace('<svg', '<svg style="forced-color-adjust:none"')
  })
}
export function contrastSvg(source: string, light = '', dark = light): string {
  const root = pictureColors(source)
  const style = `<style>${contrastMedia(light,dark)}</style>`
  return root.endsWith('</svg>') ? root.replace(/<\/svg>$/, `${style}</svg>`) : root + style
}
