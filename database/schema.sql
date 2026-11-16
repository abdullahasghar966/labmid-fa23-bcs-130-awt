-- =====================================================================
-- Lab-Mid (Advanced Web Technologies) - Variant 0
--   Catalogue resource (A) : Lab Equipment (quantity)
--   Booking resource  (B)  : Loan
--   409 rule               : not enough units left
--   Live event             : availability:changed
-- =====================================================================

CREATE TYPE user_role   AS ENUM ('admin', 'staff', 'student');
CREATE TYPE loan_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled');

-- Users come from Google sign-in (Firebase Auth). Role decides RBAC.
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    firebase_uid   TEXT UNIQUE,
    email          TEXT NOT NULL UNIQUE,
    name           TEXT,
    role           user_role NOT NULL DEFAULT 'student',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ
);

-- (A) Lab Equipment. "quantity" = total units the lab owns.
-- Units left is derived: quantity - units held by pending/confirmed loans.
CREATE TABLE equipment (
    id                       SERIAL PRIMARY KEY,
    name                     TEXT NOT NULL UNIQUE,
    description              TEXT NOT NULL DEFAULT '',
    quantity                 INTEGER NOT NULL CHECK (quantity >= 0),
    availability_changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (B) Loan. Created by a student; moves forward only:
--     pending -> confirmed -> completed, or pending/confirmed -> cancelled
-- loan_amount = the loan amount set by staff; payments are in loan_payments.
CREATE TABLE loans (
    id             SERIAL PRIMARY KEY,
    equipment_id   INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    student_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quantity       INTEGER NOT NULL CHECK (quantity > 0),
    status         loan_status NOT NULL DEFAULT 'pending',
    loan_amount    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (loan_amount >= 0),
    amount_set_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes          TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at   TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ,
    cancelled_at   TIMESTAMPTZ
);
CREATE INDEX loans_equipment_status_idx ON loans (equipment_id, status);
CREATE INDEX loans_student_idx          ON loans (student_id);

-- "How much loan paid (to loan set by staff)"
CREATE TABLE loan_payments (
    id           SERIAL PRIMARY KEY,
    loan_id      INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    recorded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX loan_payments_loan_idx ON loan_payments (loan_id);

-- Application diagram: "not enough units left -> notify when available"
CREATE TABLE availability_notifications (
    id            SERIAL PRIMARY KEY,
    equipment_id  INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    units_wanted  INTEGER NOT NULL CHECK (units_wanted > 0),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    notified_at   TIMESTAMPTZ
);
-- one open request per student per equipment
CREATE UNIQUE INDEX availability_notifications_open_idx
    ON availability_notifications (equipment_id, student_id)
    WHERE notified_at IS NULL;

-- Rule 4 enforced inside the database too: a loan can only move forward.
CREATE FUNCTION enforce_loan_forward_only() RETURNS trigger AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    IF (OLD.status = 'pending'   AND NEW.status IN ('confirmed', 'cancelled'))
    OR (OLD.status = 'confirmed' AND NEW.status IN ('completed', 'cancelled')) THEN
        NEW.updated_at := now();
        IF NEW.status = 'confirmed' THEN NEW.confirmed_at := now(); END IF;
        IF NEW.status = 'completed' THEN NEW.completed_at := now(); END IF;
        IF NEW.status = 'cancelled' THEN NEW.cancelled_at := now(); END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Loan % cannot move from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loans_forward_only
    BEFORE UPDATE ON loans
    FOR EACH ROW EXECUTE FUNCTION enforce_loan_forward_only();
