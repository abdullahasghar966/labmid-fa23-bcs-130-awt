-- Starter lab equipment so the catalogue is not empty on first run.
INSERT INTO equipment (name, description, quantity) VALUES
    ('Digital Oscilloscope',  '100 MHz, 2-channel',                 4),
    ('Arduino Uno Kit',       'Board + USB cable + jumper wires',  20),
    ('Raspberry Pi 4 (4GB)',  'With power supply and 32GB SD card', 8),
    ('Digital Multimeter',    'Auto-ranging, with probes',         15),
    ('Soldering Station',     'Temperature controlled, 60W',        5),
    ('Breadboard',            '830 tie-points',                    30);
