/** Validation / rule errors that belong on the same form, not a 500 page. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function isUserFacingError(err: unknown): err is UserFacingError {
  return err instanceof UserFacingError;
}
