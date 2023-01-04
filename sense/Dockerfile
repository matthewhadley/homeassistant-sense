ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add websocat

COPY config.yaml /
RUN grep version < config.yaml | grep -oe '[0-9\.]*' > VERSION && rm config.yaml

COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]