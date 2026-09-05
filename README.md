# Full-Stack Web Application

A modern full-stack web application built with HTML, CSS, JavaScript, Node.js, Express, and MongoDB. It includes a public-facing website, REST API, user authentication, and a protected admin panel for managing application content.

## Features

- Responsive public website built with HTML, CSS, and vanilla JavaScript
- User registration, login, logout, and JWT-based authentication
- Protected routes for authenticated users
- Role-based admin access
- Admin dashboard for managing users, content, and application data
- Create, view, update, and delete (CRUD) operations
- MongoDB database integration with Mongoose
- RESTful Express API with centralized error handling
- Input validation and secure password hashing with bcrypt
- Environment-based configuration for local and production deployments

## Technical Stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML5, CSS3, JavaScript (ES6+) |
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Authentication | JSON Web Token (JWT), bcryptjs |
| API Testing | Postman or Thunder Client |
| Version Control | Git and GitHub |

## Project Structure

```text
project-root/
|- client/
|  |- public/
|  |  |- index.html
|  |  |- login.html
|  |  |- register.html
|  |  |- dashboard.html
|  |  `- admin.html
|  |- css/
|  |  |- style.css
|  |  `- admin.css
|  |- js/
|  |  |- app.js
|  |  |- auth.js
|  |  `- admin.js
|  `- assets/
|
|- server/
|  |- config/
|  |  `- db.js
|  |- controllers/
|  |  |- authController.js
|  |  |- userController.js
|  |  `- adminController.js
|  |- middleware/
|  |  |- authMiddleware.js
|  |  |- adminMiddleware.js
|  |  `- errorMiddleware.js
|  |- models/
|  |  |- User.js
|  |  `- Content.js
|  |- routes/
|  |  |- authRoutes.js
|  |  |- userRoutes.js
|  |  `- adminRoutes.js
|  |- utils/
|  |  `- generateToken.js
|  `- server.js
|
|- .env.example
|- .gitignore
|- package.json
`- README.md
```

## Getting Started

### Prerequisites

Install the following before running the project:

- Node.js 18 or later
- npm 9 or later
- MongoDB locally, or a MongoDB Atlas database
- Git

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/your-username/your-repository.git
   ```

2. Open the project directory:

   ```bash
   cd your-repository
   ```

3. Install server dependencies:

   ```bash
   npm install
   ```

4. Create an environment file from the example:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Add the required values in `.env`.

6. Start the development server:

   ```bash
   npm run dev
   ```

   Or start it normally:

   ```bash
   npm start
   ```

7. Open the frontend in a browser. With a separate static frontend, serve the `client` directory using Live Server or any static file server.

## Environment Variables

Create a `.env` file in the project root. Do not commit this file to GitHub.

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/project_database
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
CLIENT_URL=http://127.0.0.1:5500
```

For MongoDB Atlas, set `MONGODB_URI` to your Atlas connection string:

```env
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/<database>?retryWrites=true&w=majority
```

## Pages

| Page | Route or File | Purpose |
| --- | --- | --- |
| Home | `/` or `index.html` | Main public landing page |
| Login | `/login` or `login.html` | User authentication |
| Register | `/register` or `register.html` | New user registration |
| User Dashboard | `/dashboard` or `dashboard.html` | Authenticated user area |
| Admin Login | `/admin/login` | Admin sign-in entry point |
| Admin Dashboard | `/admin` or `admin.html` | Protected administration area |
| Users Management | `/admin/users` | View, update, or remove user accounts |
| Content Management | `/admin/content` | Create, update, publish, or delete content |

## Admin Panel

The admin panel is available only to users whose role is `admin`. It should be protected at both levels:

- **Frontend:** Redirect unauthenticated or non-admin users away from admin pages.
- **Backend:** Verify the JWT and check `user.role === 'admin'` before allowing admin API requests.

Recommended dashboard sections:

- Overview cards for total users, active users, and content records
- Users table with search, role update, and delete actions
- Content form and listing for CRUD management
- Profile and logout controls

Example admin API routes:

```text
GET    /api/admin/stats
GET    /api/admin/users
PATCH  /api/admin/users/:id/role
DELETE /api/admin/users/:id
GET    /api/admin/content
POST   /api/admin/content
PATCH  /api/admin/content/:id
DELETE /api/admin/content/:id
```

## API Overview

```text
POST /api/auth/register       Register a user
POST /api/auth/login          Log in and receive a JWT
GET  /api/users/profile       Get the current user's profile
PUT  /api/users/profile       Update the current user's profile
GET  /api/admin/users         List users (admin only)
```

Send protected requests with the authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

## Migration Notes

Use these notes when moving an existing HTML/CSS/JavaScript project to this full-stack structure.

1. Move static files into `client/` and keep shared styles and scripts in the `css/` and `js/` directories.
2. Replace browser-only storage for important data with API requests to the Express server.
3. Move user and content data into MongoDB collections through Mongoose models.
4. Store passwords only after hashing them with bcrypt. Never save plain-text passwords.
5. Replace hardcoded secrets, API URLs, and database credentials with environment variables.
6. Add JWT middleware before exposing protected user or admin endpoints.
7. Add a `role` field to the user model, defaulting to `user`; assign `admin` only through a controlled process.
8. Test the API before connecting each frontend screen, then validate the full user and admin workflows.

## Security Notes

- Add `.env` to `.gitignore`.
- Use a long, random `JWT_SECRET` in production.
- Validate and sanitize request data.
- Configure CORS to allow only trusted frontend origins.
- Use HTTPS and secure cookies when deploying to production.

## License

Add the license that applies to this repository, for example `MIT`.
