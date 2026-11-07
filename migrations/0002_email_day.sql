-- Day of the month the summary email is sent (default: the 1st). Months shorter than this use their last day.
ALTER TABLE users ADD COLUMN email_day INTEGER NOT NULL DEFAULT 1;
