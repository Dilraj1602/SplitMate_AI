from sqlalchemy import text
from backend.app.db.session import engine

if engine is None:
    print("Database engine is not configured.")
else:
    with engine.connect() as connection:
        result = connection.execute(
            text("SELECT current_database(), current_schema(), current_user")
        )
        print("Connection:", result.one())

        result = connection.execute(
            text(
                """
                SELECT table_schema, table_name
                FROM information_schema.tables
                WHERE table_name IN ('users', 'recurring_autopays')
                ORDER BY table_name
                """
            )
        )
        print("Tables:", result.all())