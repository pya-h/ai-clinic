export interface ICacheItemIdentifier {
  group: string;
  key: string;
  deadline: Date;
  ttl: number;
}
