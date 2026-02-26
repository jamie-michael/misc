export class ResError extends Error {
  constructor(message,statusCode) {
    super(message)
    this.statusCode = statusCode
  }
}

// 400 Bad Request
export class BadRequest extends ResError {
  constructor(message) {
    super(message || `Bad Request`,400)
  }
}

// 401 Not Authenticated
export class NotAuthenticated extends ResError {
  constructor(message) {
    super(message || `Not Authenticated`,401)
  }
}

// 403 Forbidden
export class Forbidden extends ResError {
  constructor(message) {
    super(message || `Forbidden`,403)
  }
}

// 404 Not Found
export class NotFound extends ResError {
  constructor(message) {
    super(message || `Not Found`,404)
  }
}

// 409 Conflict
export class Conflict extends ResError {
  constructor(message) {
    super(message || `Conflict`,409)
  }
}

// 500 Internal Server Error
export class InternalServerError extends ResError {
  constructor(message) {
    super(message || `Internal Server Error`,500)
  }
}