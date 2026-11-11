declare module 'saxen' {
  export class Parser {
    on(event: 'openTag', callback: (name: string, getAttrs: () => Record<string, string>) => void): this
    on(event: 'error' | 'warn', callback: (error: Error) => void): this
    on(event: 'attention', callback: (declaration: string) => void): this
    parse(xml: string): void
  }
}
