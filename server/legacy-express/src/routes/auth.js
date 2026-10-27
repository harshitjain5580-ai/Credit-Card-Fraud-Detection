import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";

import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import User from "../models/User.js";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1),
}).strict();

function serializeUser(user) {
  return {
    id: String(user._id ?? user.id),
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

function issueToken(user, jwtSecret) {
  return jwt.sign(
    { role: user.role },
    jwtSecret,
    { subject: String(user._id ?? user.id), expiresIn: "7d" },
  );
}

function requestError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function createAuthRouter({
  jwtSecret,
  UserModel = User,
} = {}) {
  if (!jwtSecret) {
    throw new Error("A JWT secret is required to configure authentication routes.");
  }

  const router = Router();
  const authenticate = requireAuth(jwtSecret);

  router.post(
    "/register",
    validate(registerSchema),
    async (request, response, next) => {
      try {
        const { name, email, password } = request.validated.body;
        const passwordHash = await bcrypt.hash(password, 12);
        const user = await UserModel.create({
          name,
          email: email.toLowerCase(),
          passwordHash,
          role: "merchant",
        });
        return response.status(201).json({
          token: issueToken(user, jwtSecret),
          user: serializeUser(user),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/login",
    validate(loginSchema),
    async (request, response, next) => {
      try {
        const { email, password } = request.validated.body;
        const user = await UserModel.findOne({
          email: email.toLowerCase(),
        }).select("+passwordHash");
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
          return next(
            requestError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS"),
          );
        }
        return response.json({
          token: issueToken(user, jwtSecret),
          user: serializeUser(user),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get("/me", authenticate, async (request, response, next) => {
    try {
      const user = await UserModel.findById(request.auth.userId);
      if (!user) {
        return next(requestError(401, "User account was not found.", "UNAUTHORIZED"));
      }
      return response.json({ user: serializeUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
