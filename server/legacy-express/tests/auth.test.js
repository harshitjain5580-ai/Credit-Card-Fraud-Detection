import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";

import { createApp } from "../src/app.js";

const config = {
  PORT: 5000,
  CLIENT_URL: "http://localhost:5173",
  JWT_SECRET: "a-test-secret-with-at-least-32-characters",
};

function createUserModel() {
  const users = [];
  return {
    users,
    async create(userData) {
      const user = {
        ...userData,
        _id: `user-${users.length + 1}`,
      };
      users.push(user);
      return user;
    },
    findOne({ email }) {
      return {
        select: async () =>
          users.find((user) => user.email === email) ?? null,
      };
    },
    async findById(id) {
      return users.find((user) => user._id === id) ?? null;
    },
  };
}

describe("authentication routes", () => {
  it("registers a merchant and returns the contract user shape", async () => {
    const UserModel = createUserModel();
    const app = createApp({ config, UserModel });
    const response = await request(app).post("/api/auth/register").send({
      name: "Merchant One",
      email: "MERCHANT@example.com",
      password: "password-123",
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toEqual({
      id: "user-1",
      name: "Merchant One",
      email: "merchant@example.com",
      role: "merchant",
    });
    expect(response.body.token).toEqual(expect.any(String));
    expect(UserModel.users[0].passwordHash).not.toBe("password-123");
    expect(await bcrypt.compare("password-123", UserModel.users[0].passwordHash)).toBe(
      true,
    );
    expect(jwt.verify(response.body.token, config.JWT_SECRET).exp).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
  });

  it("rejects passwords shorter than eight characters with a contract error", async () => {
    const app = createApp({ config, UserModel: createUserModel() });
    const response = await request(app).post("/api/auth/register").send({
      name: "Merchant One",
      email: "merchant@example.com",
      password: "short",
    });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("logs in and returns the same safe user shape", async () => {
    const UserModel = createUserModel();
    const passwordHash = await bcrypt.hash("password-123", 12);
    UserModel.users.push({
      _id: "user-1",
      name: "Merchant One",
      email: "merchant@example.com",
      passwordHash,
      role: "merchant",
    });
    const app = createApp({ config, UserModel });

    const response = await request(app).post("/api/auth/login").send({
      email: "MERCHANT@example.com",
      password: "password-123",
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      id: "user-1",
      name: "Merchant One",
      email: "merchant@example.com",
      role: "merchant",
    });
    expect(response.body.token).toEqual(expect.any(String));
  });

  it("protects /me and returns the authenticated user", async () => {
    const UserModel = createUserModel();
    UserModel.users.push({
      _id: "user-1",
      name: "Merchant One",
      email: "merchant@example.com",
      passwordHash: "not-returned",
      role: "merchant",
    });
    const app = createApp({ config, UserModel });
    const token = jwt.sign(
      { role: "merchant" },
      config.JWT_SECRET,
      { subject: "user-1", expiresIn: "7d" },
    );

    const unauthorized = await request(app).get("/api/auth/me");
    const authorized = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.code).toBe("UNAUTHORIZED");
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({
      user: {
        id: "user-1",
        name: "Merchant One",
        email: "merchant@example.com",
        role: "merchant",
      },
    });
  });

  it("does not reveal whether a login email exists", async () => {
    const app = createApp({ config, UserModel: createUserModel() });
    const response = await request(app).post("/api/auth/login").send({
      email: "unknown@example.com",
      password: "password-123",
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        message: "Email or password is incorrect.",
        code: "INVALID_CREDENTIALS",
      },
    });
  });
});
