export class AppError extends Error {
  constructor(message: string, public readonly source: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConfigValidationError extends AppError {
  constructor(message: string) {
    super(message, "config");
  }
}

export class AuthError extends AppError {
  constructor(message: string, public readonly reason: string) {
    super(message, "auth");
  }
}

export class MicroMdmError extends AppError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, "micromdm");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "validation");
  }
}

export class NotWhitelistedCommandError extends AppError {
  constructor(commandName: string) {
    super(`Command "${commandName}" không nằm trong whitelist của /api.`, "api-command");
  }
}

export class ConfirmRequiredError extends AppError {
  constructor(commandName: string) {
    super(
      `Lệnh "${commandName}" là lệnh nguy hiểm, cần thêm từ khoá CONFIRM ở cuối để thực thi.`,
      "api-command"
    );
  }
}
