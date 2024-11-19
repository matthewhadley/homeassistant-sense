## [0.12.1] - 2024-11-18

### Added

- Timeout logging

## [0.12.0] - 2024-11-18

### Fixed

- Timeout logic
- Timeout config not showing

## [0.11.0] - 2024-11-18

### Fixed

- gracefully catch network errors when updating HA

### Added

- timeout for receiving sense data, after which websocket coonection gets re-established
- local development flags

## [0.10.1] - 2024-11-16

### Fixed

- fix missing icon

## [0.10.0] - 2024-11-16

### BREAKING

- rename sensor to "Sense Realtime Power" with device type "power"

## [0.9.0] - 2024-03-13

### Changed

- move to timed interval based recording of values vs number of messages for consistent interval reporting

## [0.8.2] - 2024-02-01

### Fixed

- remove unused variable

## [0.8.1] - 2024-02-29

### Changed

- update log output

## [0.8.0] - 2024-02-29

### Added

- add ping/pong connection status check

### Changed

- reduce log output

## [0.7.12] - 2024-02-28

### Added

- increase debug log output

## [0.7.11] - 2024-02-27

### Added

- debug log output

## [0.7.10] - 2023-01-22

### Added

- [internal] github workflow to publish add-on

## [0.7.9] - 2023-01-22

### Fixed

- fix missing log output

## [0.7.8] - 2023-01-18

### Changed

- more changes to logging

## [0.7.7] - 2023-01-18

### Changed

- changes to console

## [0.7.6] - 2023-01-18

### Changed

- change console

## [0.7.5] - 2023-01-18

### Changed

- change log output

## [0.7.4] - 2023-01-18

### Changed

- Debug log output

## [0.7.3] - 2023-01-14

### Fixed

- Writeable log file

## [0.7.2] - 2023-01-14

### Added

- Debug log file

## [0.7.1] - 2023-01-12

### Added

- npm start silent

## [0.7.0] - 2023-01-12

### Changed

- Use Node.js for websocket

## [0.6.1] - 2023-01-11

### Fixed

- remove break on error

## [0.6.0] - 2023-01-10

### Added

- debug logging

## [0.5.0] - 2023-01-09

### Changed

- re-implment websocat calls

## [0.4.0] - 2023-01-03

### Changed

- cleanup api call, increase interval range

## [0.3.1] - 2023-01-03

### Fixed

- Revert build process

## [0.3.0] - 2023-01-03

### Added

- Update build script

## [0.2.0] - 2023-01-03

### Added

- Config for altering INTERVAL for reading websocket messages

## [0.1.0] - 2023-01-02

### Added

- Beta release for testing only. Populate `sensor.sense_realtime_energy_usage`
