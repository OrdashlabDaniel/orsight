declare module "word-extractor" {
  export default class WordExtractor {
    constructor();
    extract(source: string | Buffer): Promise<{ getBody(): string }>;
  }
}
