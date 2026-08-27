/**
 * Classe base para todo erro de domínio do sistema.
 *
 * Mantida livre de qualquer preocupação HTTP/transporte de propósito — a
 * camada de API (adicionada depois) é responsável por mapear `code` pra um
 * status code, não o domínio.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
