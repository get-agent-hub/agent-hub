/** Safe, actionable errors that can be shown by the CLI and HTTP interface. */
export class HubError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HubError';
  }
}
