import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type ValidationTarget = 'body' | 'query' | 'params';

export function validate<T>(
  schema: ZodSchema<T>,
  target: ValidationTarget = 'body',
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const data = target === 'body' ? req.body : target === 'query' ? req.query : req.params;

    const result = schema.safeParse(data);

    if (!result.success) {
      const err = result.error as ZodError;
      const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Validation failed: ${issues}`,
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Attach parsed/coerced data back to the request
    if (target === 'body') {
      req.body = result.data;
    }

    next();
  };
}
