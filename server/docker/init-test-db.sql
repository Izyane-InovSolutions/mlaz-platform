-- Separate database for the automated tests, so `npm test` never touches development data.
CREATE DATABASE mlaz_test OWNER mlaz;
