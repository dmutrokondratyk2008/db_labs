"""Аутентифікація: реєстрація, вхід, вихід, розмежування прав за ролями."""
from functools import wraps

from flask import (Blueprint, abort, flash, g, redirect, render_template, request,
                   session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from database import DBError, execute, log_activity, query_one
from validators import validate_registration

bp = Blueprint("auth", __name__)


def load_current_user():
    """Викликається перед кожним запитом: завантажує користувача з сесії в g.user."""
    g.user = None
    user_id = session.get("user_id")
    if user_id:
        user = query_one("""
            SELECT user_id, username, full_name, email, role, manager_id, is_active
            FROM users WHERE user_id = %s
        """, (user_id,))
        if user and user["is_active"]:
            g.user = user
        else:
            session.clear()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Увійдіть у систему, щоб продовжити", "error")
            return redirect(url_for("auth.login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def role_required(*roles):
    """Доступ лише для вказаних ролей; інакше 403."""
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if g.user is None:
                return redirect(url_for("auth.login", next=request.path))
            if g.user["role"] not in roles:
                log_activity("ACCESS_DENIED", details=f"{request.method} {request.path}")
                abort(403)
            return view(*args, **kwargs)
        return wrapped
    return decorator


def can(*roles):
    return g.user is not None and g.user["role"] in roles


@bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = query_one("SELECT user_id, password_hash, is_active FROM users WHERE username = %s",
                         (username,))
        if user is None or not check_password_hash(user["password_hash"], password):
            log_activity("LOGIN_FAILED", "users", details=f"Невдала спроба входу: {username}")
            flash("Невірний логін або пароль", "error")
        elif not user["is_active"]:
            flash("Обліковий запис заблоковано адміністратором", "error")
        else:
            session.clear()
            session["user_id"] = user["user_id"]
            execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = %s",
                    (user["user_id"],))
            log_activity("LOGIN", "users", user["user_id"], user_id=user["user_id"])
            flash(f"Вітаємо, {username}!", "success")
            next_url = request.args.get("next")
            if not next_url or not next_url.startswith("/"):
                next_url = url_for("index")
            return redirect(next_url)
    return render_template("login.html")


@bp.route("/register", methods=["GET", "POST"])
def register():
    data, errors = {}, {}
    if request.method == "POST":
        data, errors = validate_registration(request.form)
        if not errors:
            try:
                row = execute("""
                    INSERT INTO users (username, password_hash, email, full_name, role)
                    VALUES (%s, %s, %s, %s, 'viewer') RETURNING user_id
                """, (data["username"], generate_password_hash(data["password"]),
                      data["email"].lower(), data["full_name"]))
                log_activity("REGISTER", "users", row["user_id"], user_id=row["user_id"],
                             details="Новий користувач з роллю viewer")
                flash("Реєстрація успішна. Увійдіть з новим логіном "
                      "(роль «перегляд», розширені права надає адміністратор).", "success")
                return redirect(url_for("auth.login"))
            except DBError as e:
                if "users_username_key" in str(e) or "username" in str(e):
                    errors["username"] = "Такий логін уже існує"
                elif "email" in str(e):
                    errors["email"] = "Такий email уже зареєстровано"
                else:
                    flash(f"Помилка реєстрації: {e}", "error")
        data.pop("password", None)
    return render_template("register.html", data=data, errors=errors)


@bp.route("/logout")
def logout():
    if g.user:
        log_activity("LOGOUT", "users", g.user["user_id"])
    session.clear()
    flash("Ви вийшли з системи", "success")
    return redirect(url_for("auth.login"))
