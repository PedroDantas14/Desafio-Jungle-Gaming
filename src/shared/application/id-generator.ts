/**
 * Porta pra geração de id de entidade. Os use cases dependem disso, não
 * de `uuidv7()` diretamente — permite um fake determinístico nos testes
 * unitários (ver `*.use-case.test.ts`).
 *
 * `abstract class`, não `interface`: interface não tem identidade em
 * runtime, então um construtor `@Injectable()` com parâmetro tipado como
 * interface faz o NestJS falhar ao resolver a injeção (o metadata de
 * decorator emite `Object` pra interface, não um token utilizável).
 * Abstract class resolve isso — é o próprio padrão documentado do NestJS
 * pra "interface com DI".
 */
export abstract class IdGenerator {
  abstract next(): string;
}
